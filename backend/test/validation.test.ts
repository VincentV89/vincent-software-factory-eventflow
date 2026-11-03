import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/lib/http.js';
import { validateConfirmationId, validateEventId, validateRegistration } from '../src/lib/validation.js';
import { emailHash, newConfirmationId } from '../src/lib/ids.js';
import { parseGroups } from '../src/lib/auth.js';
import { generateMockRegistrations } from '../src/lib/mock-data.js';

describe('validateRegistration', () => {
  it('normalizes valid input', () => {
    expect(validateRegistration({ name: '  Ada   Lovelace ', email: ' Ada@Example.COM ', organization: 'Analytical Engines' })).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      organization: 'Analytical Engines',
    });
  });
  it.each([
    [{ name: 'A', email: 'a@b.co', organization: 'Org' }, 'name'],
    [{ name: 'Ada', email: 'not-an-email', organization: 'Org' }, 'email'],
    [{ name: 'Ada', email: 'a@b', organization: 'Org' }, 'email'],
    [{ name: 'Ada', email: 'a@b.co' }, 'organization'],
    [{ name: '<script>', email: 'a@b.co', organization: 'Org' }, 'name'],
    [{ name: 'x'.repeat(101), email: 'a@b.co', organization: 'Org' }, 'name'],
  ])('rejects %j (%s)', (body, field) => {
    try {
      validateRegistration(body);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(400);
      expect((e as HttpError).details).toHaveProperty(field);
    }
  });
  it('rejects non-object bodies', () => {
    expect(() => validateRegistration([1])).toThrow(HttpError);
    expect(() => validateRegistration(null)).toThrow(HttpError);
  });
});

describe('ids', () => {
  it('generates unique, well-formed confirmation ids', () => {
    const ids = new Set(Array.from({ length: 5000 }, newConfirmationId));
    expect(ids.size).toBe(5000);
    for (const id of ids) expect(validateConfirmationId(id)).toBe(id);
  });
  it('hashes emails case-insensitively', () => {
    expect(emailHash('A@B.co')).toBe(emailHash(' a@b.co'));
    expect(emailHash('a@b.co')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('validates event ids', () => {
    expect(validateEventId('cloudsummit-2027')).toBe('cloudsummit-2027');
    expect(() => validateEventId('../etc')).toThrow(HttpError);
    expect(() => validateEventId(undefined)).toThrow(HttpError);
  });
});

describe('parseGroups', () => {
  it('handles API Gateway claim formats', () => {
    expect(parseGroups('[organizers]')).toEqual(['organizers']);
    expect(parseGroups('[organizers admins]')).toEqual(['organizers', 'admins']);
    expect(parseGroups(['organizers'])).toEqual(['organizers']);
    expect(parseGroups(undefined)).toEqual([]);
  });
});

describe('mock data', () => {
  it('produces unique fictional emails', () => {
    const regs = generateMockRegistrations('e', 150, new Date('2026-11-01T00:00:00Z'));
    expect(regs).toHaveLength(150);
    expect(new Set(regs.map((r) => r.email)).size).toBe(150);
    expect(regs.every((r) => r.email.endsWith('.example'))).toBe(true);
  });
});
