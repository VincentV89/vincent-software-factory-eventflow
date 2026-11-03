#!/usr/bin/env node
/**
 * End-to-end smoke test against the deployed stack:
 *  website + config, CORS, public API, validation, duplicate guard, DynamoDB persistence,
 *  authN/authZ on organizer APIs, cancellation, and a concurrent capacity race on a throwaway event.
 * All test data uses *.example addresses and is removed at the end (pass --keep to keep the smoke registration).
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { REGION, stackOutputs } from './lib.mjs';

const keep = process.argv.includes('--keep');
const out = await stackOutputs();
const API = out.ApiUrl;
const SITE = out.WebsiteUrl;
const EVENT = out.EventId;
const ddb = new DynamoDBClient({ region: REGION });
const idp = new CognitoIdentityProviderClient({ region: REGION });
let passed = 0;
let failed = 0;
const cleanup = [];

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}${extra ? ` – ${extra}` : ''}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${extra ? ` – ${extra}` : ''}`);
  }
}
async function call(method, path, { body, token, origin, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const password = () => `Sm0ke!${randomBytes(9).toString('base64url')}${randomInt(10)}aA`;
async function tempUser(group) {
  const email = `smoke-${group ?? 'nogroup'}-${Date.now()}@eventflow-smoke.example`;
  const pw = password();
  await idp.send(new AdminCreateUserCommand({ UserPoolId: out.UserPoolId, Username: email, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }] }));
  cleanup.push(() => idp.send(new AdminDeleteUserCommand({ UserPoolId: out.UserPoolId, Username: email })));
  await idp.send(new AdminSetUserPasswordCommand({ UserPoolId: out.UserPoolId, Username: email, Password: pw, Permanent: true }));
  if (group) await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: out.UserPoolId, Username: email, GroupName: group }));
  const auth = await idp.send(new InitiateAuthCommand({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: out.UserPoolClientId, AuthParameters: { USERNAME: email, PASSWORD: pw } }));
  return auth.AuthenticationResult.AccessToken;
}
async function deletePartition(pk) {
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: out.TableName, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': { S: pk } }, ExclusiveStartKey }));
    for (const it of r.Items ?? []) await ddb.send(new DeleteItemCommand({ TableName: out.TableName, Key: { PK: it.PK, SK: it.SK } }));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

try {
  console.log(`Stack outputs: site=${SITE} api=${API} table=${out.TableName} region=${REGION}`);

  console.log('\n[1] Frontend hosting');
  const home = await fetch(SITE);
  const html = await home.text();
  check('CloudFront serves index.html over HTTPS', home.status === 200 && html.includes('id="root"'), `HTTP ${home.status}`);
  check('Security headers present', !!home.headers.get('content-security-policy') && !!home.headers.get('strict-transport-security'));
  const deep = await fetch(`${SITE}/organizer/login`);
  check('SPA deep link returns 200', deep.status === 200);
  const cfg = await (await fetch(`${SITE}/config.json`)).json();
  check('config.json points at deployed API', cfg.apiUrl === API && cfg.userPoolClientId === out.UserPoolClientId);

  console.log('\n[2] CORS');
  const pre = await fetch(`${API}/events/${EVENT}/registrations`, { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  check('Preflight allows CloudFront origin', pre.headers.get('access-control-allow-origin') === SITE);
  const evil = await fetch(`${API}/events/${EVENT}/registrations`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  check('Preflight rejects foreign origin', !evil.headers.get('access-control-allow-origin'));

  console.log('\n[3] Public API');
  const ev1 = await call('GET', `/events/${EVENT}`);
  check('GET event returns aggregates', ev1.status === 200 && ev1.json.capacity === 300 && typeof ev1.json.registeredCount === 'number', `registered=${ev1.json.registeredCount}/${ev1.json.capacity}`);
  check('Public event response has no attendee data', !JSON.stringify(ev1.json).includes('@'));
  check('Unknown event -> 404', (await call('GET', '/events/does-not-exist')).status === 404);
  const bad = await call('POST', `/events/${EVENT}/registrations`, { body: { name: 'A', email: 'nope', organization: '' } });
  check('Invalid input -> 400 with field errors', bad.status === 400 && bad.json.error?.details?.email && bad.json.error?.details?.name);
  const email = `smoke.tester+${Date.now()}@eventflow-smoke.example`;
  const reg = await call('POST', `/events/${EVENT}/registrations`, { body: { name: 'Smoke Tester', email, organization: 'EventFlow QA' }, origin: SITE });
  check('Registration -> 201 with confirmation id', reg.status === 201 && /^EVF-[0-9A-Z]{10}$/.test(reg.json.confirmationId ?? ''), reg.json.confirmationId);
  check('Response carries CORS header for site', reg.headers.get('access-control-allow-origin') === SITE);
  const cid = reg.json.confirmationId;
  const dup = await call('POST', `/events/${EVENT}/registrations`, { body: { name: 'Smoke Tester', email: email.toUpperCase(), organization: 'EventFlow QA' } });
  check('Duplicate email (case-insensitive) -> 409', dup.status === 409 && dup.json.error?.code === 'DUPLICATE_REGISTRATION');
  const ev2 = await call('GET', `/events/${EVENT}`);
  check('Counter incremented by exactly 1', ev2.json.registeredCount === ev1.json.registeredCount + 1);

  console.log('\n[4] DynamoDB persistence');
  const item = await ddb.send(new GetItemCommand({ TableName: out.TableName, Key: { PK: { S: `EVENT#${EVENT}` }, SK: { S: `REG#${cid}` } }, ConsistentRead: true }));
  check('Registration item stored in DynamoDB', item.Item?.email?.S === email.toLowerCase() && item.Item?.status?.S === 'CONFIRMED', `PK=EVENT#${EVENT} SK=REG#${cid}`);

  console.log('\n[5] Organizer API security');
  check('No token -> 401', (await call('GET', `/events/${EVENT}/registrations`)).status === 401);
  check('Garbage token -> 401', (await call('GET', `/events/${EVENT}/registrations`, { token: 'abc.def.ghi' })).status === 401);
  const userToken = await tempUser(undefined);
  check('Authenticated non-organizer -> 403', (await call('GET', `/events/${EVENT}/registrations`, { token: userToken })).status === 403);
  check('Non-organizer cannot cancel -> 403', (await call('DELETE', `/events/${EVENT}/registrations/${cid}`, { token: userToken })).status === 403);
  const orgToken = await tempUser(out.OrganizerGroup);
  const list = await call('GET', `/events/${EVENT}/registrations`, { token: orgToken });
  check('Organizer can list attendees', list.status === 200 && list.json.registrations.some((r) => r.confirmationId === cid), `${list.json.registrations?.length} registrations`);

  console.log('\n[6] Cancellation');
  const del = await call('DELETE', `/events/${EVENT}/registrations/${cid}`, { token: orgToken });
  check('Organizer cancel -> 200', del.status === 200 && del.json.status === 'CANCELLED');
  check('Second cancel -> 409', (await call('DELETE', `/events/${EVENT}/registrations/${cid}`, { token: orgToken })).status === 409);
  const ev3 = await call('GET', `/events/${EVENT}`);
  check('Seat released (counter back)', ev3.json.registeredCount === ev1.json.registeredCount);
  const item2 = await ddb.send(new GetItemCommand({ TableName: out.TableName, Key: { PK: { S: `EVENT#${EVENT}` }, SK: { S: `REG#${cid}` } }, ConsistentRead: true }));
  check('DynamoDB item marked CANCELLED', item2.Item?.status?.S === 'CANCELLED');
  const rereg = await call('POST', `/events/${EVENT}/registrations`, { body: { name: 'Smoke Tester', email, organization: 'EventFlow QA' } });
  check('Can re-register after cancellation', rereg.status === 201);
  if (rereg.status === 201) await call('DELETE', `/events/${EVENT}/registrations/${rereg.json.confirmationId}`, { token: orgToken });
  if (!keep) {
    cleanup.push(async () => {
      for (const c of [cid, rereg.json.confirmationId].filter(Boolean)) {
        await ddb.send(new DeleteItemCommand({ TableName: out.TableName, Key: { PK: { S: `EVENT#${EVENT}` }, SK: { S: `REG#${c}` } } }));
      }
    });
  }

  console.log('\n[7] Capacity under concurrency (throwaway event, capacity 5, 30 parallel requests)');
  const raceId = `smoke-race-${Date.now()}`;
  cleanup.push(() => deletePartition(`EVENT#${raceId}`));
  await ddb.send(new PutItemCommand({ TableName: out.TableName, Item: { PK: { S: `EVENT#${raceId}` }, SK: { S: 'META' }, type: { S: 'EVENT' }, eventId: { S: raceId }, name: { S: 'Race' }, capacity: { N: '5' }, registeredCount: { N: '0' } } }));
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) => call('POST', `/events/${raceId}/registrations`, { body: { name: `Racer ${i}`, email: `racer${i}@eventflow-smoke.example`, organization: 'Race Org' } })),
  );
  const ok = results.filter((r) => r.status === 201).length;
  const full = results.filter((r) => r.json?.error?.code === 'EVENT_FULL').length;
  const busy = results.filter((r) => r.status === 503).length;
  check('Exactly 5 registrations accepted', ok === 5, `201=${ok} EVENT_FULL=${full} 503=${busy}`);
  const meta = await ddb.send(new GetItemCommand({ TableName: out.TableName, Key: { PK: { S: `EVENT#${raceId}` }, SK: { S: 'META' } }, ConsistentRead: true }));
  check('Counter never exceeds capacity', meta.Item?.registeredCount?.N === '5', `registeredCount=${meta.Item?.registeredCount?.N}`);
  const regCount = await ddb.send(new QueryCommand({ TableName: out.TableName, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :r)', ExpressionAttributeValues: { ':pk': { S: `EVENT#${raceId}` }, ':r': { S: 'REG#' } }, Select: 'COUNT' }));
  check('Exactly 5 registration items persisted', regCount.Count === 5);
} catch (e) {
  failed++;
  console.error('Smoke test crashed:', e);
} finally {
  for (const c of cleanup.reverse()) await c().catch((e) => console.warn('cleanup warning:', e.message));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
