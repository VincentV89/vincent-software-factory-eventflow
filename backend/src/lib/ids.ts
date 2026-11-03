import { createHash, randomBytes } from 'node:crypto';

// Crockford base32 alphabet (no I, L, O, U) – unambiguous when read aloud or typed.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 10 random base32 chars = 50 bits of entropy, e.g. EVF-7K2M9QX4TB */
export function newConfirmationId(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] & 31];
  return `EVF-${out}`;
}

/** Keys never contain raw email addresses: the uniqueness lock uses a SHA-256 digest. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
