import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { json, parseJsonBody, withErrorHandling } from '../lib/http.js';
import { createRegistration } from '../lib/repository.js';
import { validateEventId, validateRegistration } from '../lib/validation.js';

/** POST /events/{eventId}/registrations – public. */
export const handler = withErrorHandling('register', async (event: APIGatewayProxyEventV2) => {
  const eventId = validateEventId(event.pathParameters?.eventId);
  const input = validateRegistration(parseJsonBody(event));
  const reg = await createRegistration(eventId, input);
  // Echo back only what the registrant submitted, plus the confirmation id.
  return json(201, {
    confirmationId: reg.confirmationId,
    eventId: reg.eventId,
    name: reg.name,
    email: reg.email,
    organization: reg.organization,
    status: reg.status,
    createdAt: reg.createdAt,
  });
});
