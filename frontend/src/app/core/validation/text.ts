/** Text helpers pinned to the same behaviour as TextRules.cs. */

/** Exactly JavaScript's \s / trim() whitespace set, as ranges (mirrors TextRules.WhitespaceRanges). */
export const WHITESPACE_RANGES: [number, number][] = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

export function isWhitespace(code: number): boolean {
  for (const [lo, hi] of WHITESPACE_RANGES) if (code >= lo && code <= hi) return true;
  return false;
}

export function trim(s: string | null | undefined): string {
  if (!s) return '';
  let start = 0;
  let end = s.length - 1;
  while (start <= end && isWhitespace(s.charCodeAt(start))) start++;
  while (end >= start && isWhitespace(s.charCodeAt(end))) end--;
  return s.substring(start, end + 1);
}

/** 1000 → "1,000". */
export function count(n: number): string {
  const digits = String(Math.abs(Math.trunc(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return (n < 0 ? '-' : '') + out;
}

export const formatNumber = (n: number): string => String(n);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2024-01-05" → "Jan 5, 2024". */
export function shortDate(iso: string): string {
  const p = iso.split('-');
  return p.length === 3 ? `${MONTHS[+p[1] - 1]} ${+p[2]}, ${p[0]}` : iso;
}

export function isIsoDate(s: string | null | undefined): s is string {
  if (s == null || s.length !== 10 || s[4] !== '-' || s[7] !== '-') return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    if (s[i] < '0' || s[i] > '9') return false;
  }
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  if (y < 1000 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

/** Same as /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ with the shared whitespace set. */
export function isEmail(v: string): boolean {
  const at = v.indexOf('@');
  if (at <= 0 || at !== v.lastIndexOf('@')) return false;
  for (let i = 0; i < v.length; i++) if (isWhitespace(v.charCodeAt(i))) return false;
  const domain = v.slice(at + 1);
  for (let i = domain.length - 3; i >= 1; i--) if (domain[i] === '.') return true;
  return false;
}

/** Accepts "12", "-3", "4.5"; rejects exponents, "+", spaces. Returns null when invalid. */
export function parseNumber(v: string): number | null {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(v) ? Number(v) : null;
}

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
