import { ACCENTS, accentInfo, contrast, formatRatio, normalizeHex } from './accent';

describe('accent colours (design-system FB.accentInfo port)', () => {
  it('normalizes hex input', () => {
    expect(normalizeHex('0f766e')).toBe('#0F766E');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('#12345')).toBeNull();
  });

  it('presets keep their documented light/dark pairs and pass 4.5:1', () => {
    for (const a of ACCENTS) {
      const i = accentInfo(a.key)!;
      expect(i.light).toBe(a.light);
      expect(i.dark).toBe(a.dark);
      expect(i.ok).toBe(true);
      expect(i.warning).toBeNull();
    }
    expect(formatRatio(contrast('#2347C5', '#FFFFFF'))).toBe('7.55:1');
  });

  it('a custom hex equal to a preset resolves to that preset', () => {
    expect(accentInfo('#0F766E')!.key).toBe('teal');
  });

  it('warns about low contrast (below 3:1) and lightens the dark-theme variant to 4.5:1', () => {
    const i = accentInfo('#F5C518')!;
    expect(i.uiOk).toBe(false);
    expect(i.warning).toMatch(/below 3:1/);
    expect(i.onLight).toBe('#0E1014');
    const mid = accentInfo('#2E9E5B')!;
    expect(mid.warning).toMatch(/below 4.5:1/);
    expect(contrast(accentInfo('#3B0A8F')!.dark, '#161920')).toBeGreaterThanOrEqual(4.5);
  });
});
