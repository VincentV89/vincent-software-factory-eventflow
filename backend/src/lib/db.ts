import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error('TABLE_NAME is not configured');
  return t;
}

// ---- Single-table key schema -------------------------------------------------
//   PK = EVENT#<eventId>  SK = META                  -> event details + registeredCount (capacity counter)
//   PK = EVENT#<eventId>  SK = REG#<confirmationId>  -> registration (attendee PII, status)
//   PK = EVENT#<eventId>  SK = EMAIL#<sha256(email)> -> uniqueness lock for active registrations
export const keys = {
  event: (eventId: string) => ({ PK: `EVENT#${eventId}`, SK: 'META' }),
  registration: (eventId: string, confirmationId: string) => ({ PK: `EVENT#${eventId}`, SK: `REG#${confirmationId}` }),
  emailLock: (eventId: string, hash: string) => ({ PK: `EVENT#${eventId}`, SK: `EMAIL#${hash}` }),
};
