const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');

/** "Nov 5, 2026" */
export const shortDate = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
/** "Nov 5, 2026, 14:18" (24h, local time) */
export const dateTime = (iso: string) => {
  const d = new Date(iso);
  return `${shortDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** "2026-03-14" → "March 14, 2026" */
export const longIsoDate = (iso: string) => {
  const p = iso.split('-');
  return p.length === 3 ? `${MONTHS_LONG[+p[1] - 1]} ${+p[2]}, ${p[0]}` : iso;
};

/** Relative "updated" text as used in the forms list: just now / N minutes ago / N hours ago / Yesterday / Nov 3, 2026. */
export function relativeTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) {
    const h = Math.floor(s / 3600);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  if (d.getTime() >= startOfToday - 86400000) return 'Yesterday';
  return shortDate(d);
}

export const fullDateTitle = (iso: string) => {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  return `${shortDate(d)}, ${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

export const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${n === 1 ? word : word + 's'}`;

/** Local calendar date "YYYY-MM-DD" (used as "today" for date rules on the client). */
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
