import { HttpError } from './http.js';

export interface RegistrationInput {
  name: string;
  email: string;
  organization: string;
}

// Pragmatic RFC 5322 subset: local@domain.tld, no spaces, at least one dot in domain.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Disallow control characters and angle brackets in free text.
const UNSAFE_TEXT_RE = /[\u0000-\u001F\u007F<>]/;
export const EVENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const CONFIRMATION_ID_RE = /^EVF-[0-9A-HJKMNP-TV-Z]{10}$/;

function cleanText(value: unknown, field: string, min: number, max: number, errors: Record<string, string>): string {
  if (typeof value !== 'string') {
    errors[field] = `${field} is required`;
    return '';
  }
  const v = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (v.length < min) errors[field] = `${field} must be at least ${min} characters`;
  else if (v.length > max) errors[field] = `${field} must be at most ${max} characters`;
  else if (UNSAFE_TEXT_RE.test(v)) errors[field] = `${field} contains invalid characters`;
  return v;
}

export function validateRegistration(body: unknown): RegistrationInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const name = cleanText(b.name, 'name', 2, 100, errors);
  const organization = cleanText(b.organization, 'organization', 2, 120, errors);
  let email = '';
  if (typeof b.email !== 'string' || !b.email.trim()) {
    errors.email = 'email is required';
  } else {
    email = b.email.trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'email must be a valid email address';
  }
  if (Object.keys(errors).length) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', errors);
  }
  return { name, email, organization };
}

export function validateEventId(eventId: string | undefined): string {
  if (!eventId || !EVENT_ID_RE.test(eventId)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid event id');
  return eventId;
}

export function validateConfirmationId(id: string | undefined): string {
  const v = (id ?? '').toUpperCase();
  if (!CONFIRMATION_ID_RE.test(v)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid confirmation id');
  return v;
}
