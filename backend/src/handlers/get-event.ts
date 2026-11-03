import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { HttpError, json, withErrorHandling } from '../lib/http.js';
import { getEvent } from '../lib/repository.js';
import { validateEventId } from '../lib/validation.js';

/** GET /events/{eventId} – public. Returns event details and aggregate counts only (no attendee data). */
export const handler = withErrorHandling('get-event', async (event: APIGatewayProxyEventV2) => {
  const eventId = validateEventId(event.pathParameters?.eventId);
  const ev = await getEvent(eventId);
  if (!ev) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found');
  return json(200, ev);
});
