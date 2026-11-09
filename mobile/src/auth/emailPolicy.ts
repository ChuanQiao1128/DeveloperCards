// mobile/src/auth/emailPolicy.ts
//
// Pure email normalization and format validation shared by SignIn, SignUp,
// and ForgotPassword so malformed addresses (e.g. "abc") are caught inline
// before round-tripping to Cognito.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_FORMAT_HINT = 'Enter a valid email address (for example, you@example.com).';

export function normEmail(value: string): string {
  // Trim, drop zero-width characters iOS keyboards leave on suggestions, then lowercase.
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const normalized = normEmail(value);
  return normalized.length >= 5 && EMAIL_REGEX.test(normalized);
}
