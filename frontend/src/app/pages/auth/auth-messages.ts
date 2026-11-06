import { isEmail, trim } from '../../core/validation/text';

/** Copy from screens/sign-up.html / sign-in.html (the server returns the same texts). */
export const MIN_PASSWORD = 8;
export const MSG = {
  emailEmpty: 'Enter your email address.',
  emailFormat: 'This email address is incomplete. Use the format name@example.com.',
  taken: 'An account with this email already exists.',
  pwEmpty: 'Create a password with at least 8 characters.',
  pwShort: (n: number) => {
    const more = MIN_PASSWORD - n;
    return `Password is too short (${n} of ${MIN_PASSWORD} characters). Add ${more} more character${more === 1 ? '' : 's'}.`;
  },
  pwLong: 'Use 128 characters or fewer.',
  confirmEmpty: 'Re-enter your password to confirm it.',
  mismatch: 'Passwords don’t match. Enter the same password in both fields.',
  signInPwEmpty: 'Enter your password.',
};

export function emailError(v: string): string | null {
  const s = trim(v);
  if (!s) return MSG.emailEmpty;
  if (s.length > 254 || !isEmail(s)) return MSG.emailFormat;
  return null;
}

export function newPasswordError(v: string): string | null {
  if (!v) return MSG.pwEmpty;
  if (v.length < MIN_PASSWORD) return MSG.pwShort(v.length);
  if (v.length > 128) return MSG.pwLong;
  return null;
}
