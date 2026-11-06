/** Accent colour maths ported from the design system (assets/fb.js FB.accentInfo / FB.applyAccent). */
export interface AccentPreset {
  key: string;
  name: string;
  light: string;
  dark: string;
}

export const ACCENTS: AccentPreset[] = [
  { key: 'cobalt', name: 'Cobalt', light: '#2347C5', dark: '#8CA6FF' },
  { key: 'teal', name: 'Teal', light: '#0F766E', dark: '#4FD1C5' },
  { key: 'green', name: 'Green', light: '#1E7A46', dark: '#5BC98A' },
  { key: 'amber', name: 'Amber', light: '#A14E00', dark: '#F0A84A' },
  { key: 'red', name: 'Red', light: '#C0262D', dark: '#FF8A8A' },
  { key: 'magenta', name: 'Magenta', light: '#B0207A', dark: '#F28CC8' },
  { key: 'slate', name: 'Slate', light: '#475569', dark: '#A7B4C8' },
  { key: 'indigo', name: 'Indigo', light: '#4338CA', dark: '#A5A8FF' },
];

const WHITE = '#FFFFFF';
const INK = '#0E1014';
const DARK_SURFACE = '#161920';

export function normalizeHex(h: string | null | undefined): string | null {
  let s = String(h ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return '#' + s.toUpperCase();
}

const rgb = (h: string) => {
  const n = normalizeHex(h) ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(n.substring(i, i + 2), 16));
};
const toHex = (a: number[]) =>
  '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

export function luminance(h: string): number {
  const c = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => x[i] * (1 - t) + y[i] * t));
}

export const formatRatio = (r: number) => (Math.floor(r * 100) / 100).toFixed(2) + ':1';

const pickOn = (c: string) => (contrast(c, WHITE) >= contrast(c, INK) ? WHITE : INK);

function darkVariant(hex: string): string {
  let t = 0;
  let c = hex;
  while (contrast(c, DARK_SURFACE) < 4.5 && t < 1) {
    t = Math.min(1, t + 0.05);
    c = mix(hex, WHITE, t);
  }
  return c;
}

export interface AccentInfo {
  key: string | null;
  hex: string;
  light: string;
  dark: string;
  onLight: string;
  onDark: string;
  softLight: string;
  softDark: string;
  ratio: number;
  ok: boolean;
  uiOk: boolean;
  warning: string | null;
}

export function accentInfo(input: string): AccentInfo | null {
  let preset = ACCENTS.find((a) => a.key === input) ?? null;
  const light = preset ? preset.light : normalizeHex(input);
  if (!light) return null;
  preset ??= ACCENTS.find((a) => a.light === light) ?? null;
  const dark = preset ? preset.dark : darkVariant(light);
  const ratio = contrast(light, WHITE);
  let warning: string | null = null;
  if (ratio < 3) {
    warning = `Contrast ${formatRatio(ratio)} against white is below 3:1. Buttons will switch to dark text, but outlines, selected options and links in this colour will be hard to see. Choose a darker shade.`;
  } else if (ratio < 4.5) {
    warning = `Contrast ${formatRatio(ratio)} against white is below 4.5:1. White button text and accent-coloured text would be hard to read, so buttons will use dark text. Choose a darker shade for best results.`;
  }
  return {
    key: preset?.key ?? null,
    hex: light,
    light,
    dark,
    onLight: pickOn(light),
    onDark: pickOn(dark),
    softLight: mix(light, WHITE, 0.88),
    softDark: mix(dark, DARK_SURFACE, 0.84),
    ratio,
    ok: ratio >= 4.5,
    uiOk: ratio >= 3,
    warning,
  };
}

/** CSS custom properties consumed by `.fb-public` (fb.css). Presets also work through data-accent. */
export function accentStyle(input: string): Record<string, string> {
  const i = accentInfo(input) ?? accentInfo('cobalt')!;
  return {
    '--accent-l': i.light,
    '--accent-d': i.dark,
    '--on-accent-l': i.onLight,
    '--on-accent-d': i.onDark,
    '--accent-soft-l': i.softLight,
    '--accent-soft-d': i.softDark,
  };
}
