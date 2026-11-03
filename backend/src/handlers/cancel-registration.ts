import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { requireOrganizer } from '../lib/auth.js';
import { json, withErrorHandling } from '../lib/http.js';
import { cancelRegistration } from '../lib/repository.js';
import { validateConfirmationId, validateEventId } from '../lib/validation.js';

/** DELETE /events/{eventId}/registrations/{confirmationId} – organizers only. Soft-cancels and frees the seat. */
export const handler = withErrorHandling('cancel-registration', async (event: APIGatewayProxyEventV2) => {
  const { sub } = requireOrganizer(event as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);
  const eventId = validateEventId(event.pathParameters?.eventId);
  const confirmationId = validateConfirmationId(event.pathParameters?.confirmationId);
  const reg = await cancelRegistration(eventId, confirmationId, sub);
  return json(200, { confirmationId: reg.confirmationId, status: reg.status, cancelledAt: reg.cancelledAt });
});
