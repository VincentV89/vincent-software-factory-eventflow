import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { ddb, keys, tableName } from './db.js';
import { HttpError, log } from './http.js';
import { emailHash, newConfirmationId } from './ids.js';
import type { RegistrationInput } from './validation.js';

export interface EventDetails {
  eventId: string;
  name: string;
  tagline: string;
  description: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  capacity: number;
  registeredCount: number;
}

export interface PublicEvent extends EventDetails {
  availableSeats: number;
  capacityPercent: number;
  registrationOpen: boolean;
}

export type RegistrationStatus = 'CONFIRMED' | 'CANCELLED';

export interface Registration {
  confirmationId: string;
  eventId: string;
  name: string;
  email: string;
  organization: string;
  status: RegistrationStatus;
  createdAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

const MAX_TX_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toPublicEvent(item: Record<string, unknown>): PublicEvent {
  const capacity = Number(item.capacity ?? 0);
  const registeredCount = Number(item.registeredCount ?? 0);
  const availableSeats = Math.max(0, capacity - registeredCount);
  return {
    eventId: String(item.eventId),
    name: String(item.name ?? ''),
    tagline: String(item.tagline ?? ''),
    description: String(item.description ?? ''),
    startDate: String(item.startDate ?? ''),
    endDate: String(item.endDate ?? ''),
    timezone: String(item.timezone ?? ''),
    venue: String(item.venue ?? ''),
    address: String(item.address ?? ''),
    city: String(item.city ?? ''),
    capacity,
    registeredCount,
    availableSeats,
    capacityPercent: capacity > 0 ? Math.round((registeredCount / capacity) * 1000) / 10 : 0,
    registrationOpen: availableSeats > 0,
  };
}

export async function getEvent(eventId: string): Promise<PublicEvent | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: tableName(), Key: keys.event(eventId), ConsistentRead: true }));
  return res.Item ? toPublicEvent(res.Item) : undefined;
}

function reasonCodes(err: TransactionCanceledException): string[] {
  return (err.CancellationReasons ?? []).map((r) => r.Code ?? 'None');
}

/**
 * Atomically registers an attendee. One DynamoDB transaction:
 *   1. increments the event counter only if registeredCount < capacity (capacity guard, safe under concurrency)
 *   2. creates the email uniqueness lock only if it does not exist (duplicate guard)
 *   3. creates the registration item
 * Either all three succeed or none do, so the counter can never exceed capacity.
 */
export async function createRegistration(eventId: string, input: RegistrationInput, now = new Date()): Promise<Registration> {
  const hash = emailHash(input.email);
  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    const confirmationId = newConfirmationId();
    const registration: Registration = {
      confirmationId,
      eventId,
      name: input.name,
      email: input.email,
      organization: input.organization,
      status: 'CONFIRMED',
      createdAt: now.toISOString(),
    };
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName(),
                Key: keys.event(eventId),
                UpdateExpression: 'SET registeredCount = registeredCount + :one, updatedAt = :now',
                // `capacity` is a DynamoDB reserved word, hence the #cap placeholder.
                ConditionExpression: 'attribute_exists(PK) AND registeredCount < #cap',
                ExpressionAttributeNames: { '#cap': 'capacity' },
                ExpressionAttributeValues: { ':one': 1, ':now': registration.createdAt },
                ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
              },
            },
            {
              Put: {
                TableName: tableName(),
                Item: { ...keys.emailLock(eventId, hash), type: 'EMAIL_LOCK', confirmationId, createdAt: registration.createdAt },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName(),
                Item: { ...keys.registration(eventId, confirmationId), type: 'REGISTRATION', ...registration },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      log.info('registration created', { eventId, confirmationId, attempt });
      return registration;
    } catch (err) {
      if (!(err instanceof TransactionCanceledException)) throw err;
      const [eventReason, lockReason, regReason] = reasonCodes(err);
      if (lockReason === 'ConditionalCheckFailed') {
        throw new HttpError(409, 'DUPLICATE_REGISTRATION', 'This email address is already registered for this event.');
      }
      if (eventReason === 'ConditionalCheckFailed') {
        const old = err.CancellationReasons?.[0]?.Item;
        if (!old) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found');
        throw new HttpError(409, 'EVENT_FULL', 'Sorry, this event has reached its capacity. Registration is closed.');
      }
      const retryable = [eventReason, lockReason, regReason].some((c) => c === 'TransactionConflict' || c === 'ThrottlingError') || regReason === 'ConditionalCheckFailed'; // id collision -> new id
      if (!retryable || attempt === MAX_TX_ATTEMPTS) {
        log.warn('registration transaction failed', { eventId, attempt, reasons: reasonCodes(err) });
        throw new HttpError(503, 'BUSY', 'Registration is very busy right now. Please try again in a moment.');
      }
      await sleep(Math.min(1000, 25 * 2 ** attempt) * Math.random() + 10);
    }
  }
  throw new HttpError(503, 'BUSY', 'Registration is very busy right now. Please try again in a moment.');
}

export async function listRegistrations(eventId: string): Promise<Registration[]> {
  const items: Registration[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res: QueryCommandOutput = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :reg)',
        ExpressionAttributeValues: { ':pk': `EVENT#${eventId}`, ':reg': 'REG#' },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      items.push({
        confirmationId: it.confirmationId,
        eventId: it.eventId,
        name: it.name,
        email: it.email,
        organization: it.organization,
        status: it.status,
        createdAt: it.createdAt,
        ...(it.cancelledAt ? { cancelledAt: it.cancelledAt } : {}),
      });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items;
}

/**
 * Cancels a registration atomically: marks it CANCELLED, releases the email lock
 * (so the person may re-register) and frees the seat by decrementing the counter.
 */
export async function cancelRegistration(eventId: string, confirmationId: string, actor: string, now = new Date()): Promise<Registration> {
  const regKey = keys.registration(eventId, confirmationId);
  const current = await ddb.send(new GetCommand({ TableName: tableName(), Key: regKey, ConsistentRead: true }));
  const reg = current.Item as (Registration & Record<string, unknown>) | undefined;
  if (!reg) throw new HttpError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found');
  if (reg.status === 'CANCELLED') throw new HttpError(409, 'ALREADY_CANCELLED', 'Registration is already cancelled');

  const cancelledAt = now.toISOString();
  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName(),
                Key: regKey,
                UpdateExpression: 'SET #s = :cancelled, cancelledAt = :now, cancelledBy = :actor',
                ConditionExpression: '#s = :confirmed',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':confirmed': 'CONFIRMED', ':now': cancelledAt, ':actor': actor },
              },
            },
            {
              Delete: {
                TableName: tableName(),
                Key: keys.emailLock(eventId, emailHash(reg.email)),
                ConditionExpression: 'confirmationId = :cid',
                ExpressionAttributeValues: { ':cid': confirmationId },
              },
            },
            {
              Update: {
                TableName: tableName(),
                Key: keys.event(eventId),
                UpdateExpression: 'SET registeredCount = registeredCount - :one, updatedAt = :now',
                ConditionExpression: 'registeredCount > :zero',
                ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': cancelledAt },
              },
            },
          ],
        }),
      );
      log.info('registration cancelled', { eventId, confirmationId, attempt });
      return { ...stripKeys(reg), status: 'CANCELLED', cancelledAt };
    } catch (err) {
      if (!(err instanceof TransactionCanceledException)) throw err;
      const codes = reasonCodes(err);
      if (codes[0] === 'ConditionalCheckFailed') throw new HttpError(409, 'ALREADY_CANCELLED', 'Registration is already cancelled');
      const retryable = codes.some((c) => c === 'TransactionConflict' || c === 'ThrottlingError');
      if (!retryable || attempt === MAX_TX_ATTEMPTS) {
        log.error('cancel transaction failed', { eventId, confirmationId, reasons: codes });
        throw new HttpError(503, 'BUSY', 'Could not cancel the registration right now. Please retry.');
      }
      await sleep(Math.min(1000, 25 * 2 ** attempt) * Math.random() + 10);
    }
  }
  throw new HttpError(503, 'BUSY', 'Could not cancel the registration right now. Please retry.');
}

function stripKeys(item: Record<string, unknown>): Registration {
  const { PK: _pk, SK: _sk, type: _type, cancelledBy: _cb, ...rest } = item;
  void _pk; void _sk; void _type; void _cb;
  return rest as unknown as Registration;
}
