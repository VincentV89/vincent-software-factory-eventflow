import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler as register } from '../src/handlers/register.js';
import { handler as getEvent } from '../src/handlers/get-event.js';
import { handler as list } from '../src/handlers/list-registrations.js';
import { handler as cancel } from '../src/handlers/cancel-registration.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const EVENT = { PK: 'EVENT#cloudsummit-2027', SK: 'META', eventId: 'cloudsummit-2027', name: 'CloudSummit', capacity: 300, registeredCount: 120 };

function req(over: Partial<APIGatewayProxyEventV2> & { claims?: Record<string, unknown> } = {}): APIGatewayProxyEventV2 {
  const { claims, ...rest } = over;
  return {
    version: '2.0',
    routeKey: 'x',
    rawPath: '/',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    isBase64Encoded: false,
    pathParameters: { eventId: 'cloudsummit-2027' },
    requestContext: { requestId: 'r1', ...(claims ? { authorizer: { jwt: { claims, scopes: [] } } } : {}) } as never,
    ...rest,
  } as APIGatewayProxyEventV2;
}

const body = JSON.stringify({ name: 'Ada Lovelace', email: 'ada@example.com', organization: 'Engines Ltd' });
const cancelled = (codes: string[], item?: unknown) =>
  new TransactionCanceledException({
    message: 'cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code, i) => ({ Code, ...(i === 0 && item ? { Item: item as never } : {}) })),
  });

beforeEach(() => ddbMock.reset());

describe('GET /events/{eventId}', () => {
  it('returns aggregate counts only', async () => {
    ddbMock.on(GetCommand).resolves({ Item: EVENT });
    const res = await getEvent(req());
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body);
    expect(b).toMatchObject({ capacity: 300, registeredCount: 120, availableSeats: 180, capacityPercent: 40, registrationOpen: true });
    expect(b).not.toHaveProperty('PK');
  });
  it('404s unknown events', async () => {
    ddbMock.on(GetCommand).resolves({});
    expect((await getEvent(req())).statusCode).toBe(404);
  });
});

describe('POST /events/{eventId}/registrations', () => {
  it('creates a registration with a confirmation id in one transaction', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const res = await register(req({ body }));
    expect(res.statusCode).toBe(201);
    const b = JSON.parse(res.body);
    expect(b.confirmationId).toMatch(/^EVF-[0-9A-Z]{10}$/);
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx).toHaveLength(3);
    expect(tx[0].Update?.ConditionExpression).toContain('registeredCount < #cap');
    expect(tx[0].Update?.ExpressionAttributeNames).toEqual({ '#cap': 'capacity' });
    expect(tx[1].Put?.ConditionExpression).toBe('attribute_not_exists(PK)');
    // the uniqueness key never contains the raw email
    expect(JSON.stringify(tx[1].Put?.Item)).not.toContain('ada@example.com');
  });
  it('rejects duplicates with 409', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['None', 'ConditionalCheckFailed', 'None']));
    const res = await register(req({ body }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('DUPLICATE_REGISTRATION');
  });
  it('rejects when full with 409 EVENT_FULL', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['ConditionalCheckFailed', 'None', 'None'], { PK: { S: 'x' } }));
    const res = await register(req({ body }));
    expect(JSON.parse(res.body).error.code).toBe('EVENT_FULL');
  });
  it('returns 404 when the event does not exist', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['ConditionalCheckFailed', 'None', 'None']));
    expect((await register(req({ body }))).statusCode).toBe(404);
  });
  it('retries transaction conflicts', async () => {
    ddbMock.on(TransactWriteCommand).rejectsOnce(cancelled(['TransactionConflict', 'None', 'None'])).resolves({});
    expect((await register(req({ body }))).statusCode).toBe(201);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(2);
  });
  it('validates input', async () => {
    const res = await register(req({ body: JSON.stringify({ name: 'A', email: 'x' }) }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
  it('requires JSON content type and bounded body', async () => {
    expect((await register(req({ body, headers: { 'content-type': 'text/plain' } }))).statusCode).toBe(415);
    expect((await register(req({ body: 'x'.repeat(5000) }))).statusCode).toBe(413);
    expect((await register(req({ body: '{bad' }))).statusCode).toBe(400);
  });
  it('hides internal errors', async () => {
    ddbMock.on(TransactWriteCommand).rejects(new Error('boom secret detail'));
    const res = await register(req({ body }));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
  });
});

describe('organizer endpoints', () => {
  const organizer = { sub: 'u1', 'cognito:groups': '[organizers]' };
  it('reject callers without the organizers group', async () => {
    expect((await list(req({ claims: { sub: 'u2' } }))).statusCode).toBe(403);
    expect((await list(req())).statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });
  it('lists registrations for organizers', async () => {
    ddbMock.on(GetCommand).resolves({ Item: EVENT });
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ confirmationId: 'EVF-AAAAAAAAAA', email: 'a@x.example', createdAt: '2026-01-01', status: 'CONFIRMED' }], LastEvaluatedKey: { PK: 'k' } })
      .resolves({ Items: [{ confirmationId: 'EVF-BBBBBBBBBB', email: 'b@x.example', createdAt: '2026-01-02', status: 'CONFIRMED' }] });
    const res = await list(req({ claims: organizer }));
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.registrations.map((r: { confirmationId: string }) => r.confirmationId)).toEqual(['EVF-BBBBBBBBBB', 'EVF-AAAAAAAAAA']);
  });
  it('cancels a registration, releasing lock and seat atomically', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { PK: 'p', SK: 's', confirmationId: 'EVF-AAAAAAAAAA', email: 'a@x.example', status: 'CONFIRMED' } });
    ddbMock.on(TransactWriteCommand).resolves({});
    const res = await cancel(req({ claims: organizer, pathParameters: { eventId: 'cloudsummit-2027', confirmationId: 'EVF-AAAAAAAAAA' } }));
    expect(res.statusCode).toBe(200);
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx.map((t) => Object.keys(t)[0])).toEqual(['Update', 'Delete', 'Update']);
    expect(tx[2].Update?.UpdateExpression).toContain('registeredCount - :one');
  });
  it('409s on already-cancelled registrations', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { confirmationId: 'EVF-AAAAAAAAAA', email: 'a@x.example', status: 'CANCELLED' } });
    const res = await cancel(req({ claims: organizer, pathParameters: { eventId: 'cloudsummit-2027', confirmationId: 'EVF-AAAAAAAAAA' } }));
    expect(res.statusCode).toBe(409);
  });
});
