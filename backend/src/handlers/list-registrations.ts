import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { requireOrganizer } from '../lib/auth.js';
import { HttpError, json, withErrorHandling } from '../lib/http.js';
import { getEvent, listRegistrations } from '../lib/repository.js';
import { validateEventId } from '../lib/validation.js';

/** GET /events/{eventId}/registrations – organizers only (Cognito JWT + organizers group). */
export const handler = withErrorHandling('list-registrations', async (event: APIGatewayProxyEventV2) => {
  requireOrganizer(event as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);
  const eventId = validateEventId(event.pathParameters?.eventId);
  const [ev, registrations] = await Promise.all([getEvent(eventId), listRegistrations(eventId)]);
  if (!ev) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found');
  return json(200, { event: ev, registrations });
});
