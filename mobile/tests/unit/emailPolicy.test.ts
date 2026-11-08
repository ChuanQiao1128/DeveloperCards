import { describe, expect, it } from 'vitest';
import { EMAIL_FORMAT_HINT, isValidEmail, normEmail } from '../../src/auth/emailPolicy';

describe('emailPolicy', () => {
  it('normalizes whitespace and case', () => {
    expect(normEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(normEmail('')).toBe('');
  });

  it('rejects malformed addresses that used to pass the length >= 3 check', () => {
    expect(isValidEmail('abc')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@domain')).toBe(false);
    expect(isValidEmail('user @example.com')).toBe(false);
  });

  it('accepts valid email addresses', () => {
    expect(isValidEmail('you@example.com')).toBe(true);
    expect(isValidEmail('  First.Last+tag@Sub.Domain.co.nz ')).toBe(true);
    expect(EMAIL_FORMAT_HINT).toContain('you@example.com');
  });
});
