import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { HttpError } from './http.js';

export const ORGANIZER_GROUP = process.env.ORGANIZER_GROUP ?? 'organizers';

/** cognito:groups may arrive as an array, a JSON-ish "[a b]" string, or a comma separated string. */
export function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .map((g) => g.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/**
 * API Gateway's JWT authorizer has already verified the token signature, issuer, audience/client and expiry.
 * Here we enforce authorization: the caller must be in the organizers group.
 */
export function requireOrganizer(event: APIGatewayProxyEventV2WithJWTAuthorizer): { sub: string } {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  if (!parseGroups(claims['cognito:groups']).includes(ORGANIZER_GROUP)) {
    throw new HttpError(403, 'FORBIDDEN', 'Organizer access required');
  }
  return { sub: String(claims.sub) };
}
