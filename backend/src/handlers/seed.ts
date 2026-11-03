import { BatchWriteCommand, PutCommand, UpdateCommand, type BatchWriteCommandOutput } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, keys, tableName } from '../lib/db.js';
import { DEFAULT_EVENT } from '../lib/event-config.js';
import { log } from '../lib/http.js';
import { emailHash } from '../lib/ids.js';
import { generateMockRegistrations } from '../lib/mock-data.js';

/**
 * Invoked once by a CDK Trigger after deployment.
 *  - Creates the conference event (capacity counter starts at 0) if it does not exist.
 *  - When SEED_MOCK_DATA=true and the event was just created, inserts fictional registrations
 *    and sets the counter to the number of active registrations so the data is consistent.
 * Idempotent: re-running never duplicates data or resets counters.
 */
export const handler = async (): Promise<{ created: boolean; seeded: number }> => {
  const now = new Date().toISOString();
  const { eventId, ...details } = DEFAULT_EVENT;
  let created = false;
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName(),
        Item: { ...keys.event(eventId), type: 'EVENT', eventId, ...details, registeredCount: 0, createdAt: now, updatedAt: now },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    created = true;
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    log.info('event already exists - leaving counters untouched', { eventId });
  }

  const count = Number(process.env.SEED_COUNT ?? '0');
  if (!created || process.env.SEED_MOCK_DATA !== 'true' || count <= 0) {
    return { created, seeded: 0 };
  }

  const regs = generateMockRegistrations(eventId, Math.min(count, DEFAULT_EVENT.capacity));
  const items: Record<string, unknown>[] = [];
  for (const r of regs) {
    items.push({ ...keys.registration(eventId, r.confirmationId), type: 'REGISTRATION', ...r, ...(r.status === 'CANCELLED' ? { cancelledBy: 'seed' } : {}) });
    if (r.status === 'CONFIRMED') {
      items.push({ ...keys.emailLock(eventId, emailHash(r.email)), type: 'EMAIL_LOCK', confirmationId: r.confirmationId, createdAt: r.createdAt });
    }
  }
  for (let i = 0; i < items.length; i += 25) {
    let req: Record<string, any> | undefined = {
      [tableName()]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
    };
    for (let attempt = 0; req && Object.keys(req).length && attempt < 8; attempt++) {
      const res: BatchWriteCommandOutput = await ddb.send(new BatchWriteCommand({ RequestItems: req }));
      req = res.UnprocessedItems && Object.keys(res.UnprocessedItems).length ? res.UnprocessedItems : undefined;
      if (req) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
    if (req) throw new Error('Failed to write seed batch');
  }
  const active = regs.filter((r) => r.status === 'CONFIRMED').length;
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: keys.event(eventId),
      UpdateExpression: 'SET registeredCount = registeredCount + :n',
      ExpressionAttributeValues: { ':n': active },
    }),
  );
  log.info('seeded mock registrations', { eventId, total: regs.length, active });
  return { created, seeded: regs.length };
};
