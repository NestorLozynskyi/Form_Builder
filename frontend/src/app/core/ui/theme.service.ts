import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'fb-theme';
const LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const ICON: Record<ThemePref, string> = { light: 'sun', dark: 'moon', system: 'monitor' };
const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };

/**
 * Light / dark / system theme (fb.js semantics). The choice is stored in localStorage "fb-theme"; public/theme-init.js
 * applies it before first paint. Switching suspends transitions for one style flush so a live switch looks exactly like
 * a fresh load in that theme (no colours stuck mid-transition).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly mq = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  readonly pref = signal<ThemePref>(this.readStored());
  readonly resolved = signal<'light' | 'dark'>('light');

  constructor() {
    this.apply(false);
    this.mq?.addEventListener?.('change', () => this.pref() === 'system' && this.apply(true));
  }

  icon = () => ICON[this.pref()];
  label = () => `Theme: ${LABEL[this.pref()]}. Switch to ${LABEL[NEXT[this.pref()]].toLowerCase()}`;
  cycle(): void {
    this.set(NEXT[this.pref()]);
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage blocked */
    }
    this.apply(true);
  }

  private readStored(): ThemePref {
    try {
      const s = localStorage.getItem(KEY);
      if (s === 'light' || s === 'dark' || s === 'system') return s;
    } catch {
      /* ignore */
    }
    return 'system';
  }

  private apply(live: boolean): void {
    const root = this.doc.documentElement;
    const pref = this.pref();
    const next = pref === 'system' ? (this.mq?.matches ? 'dark' : 'light') : pref;
    const switching = live && root.getAttribute('data-theme') !== next;
    if (switching) root.classList.add('fb-theme-switching');
    root.setAttribute('data-theme', next);
    root.setAttribute('data-theme-pref', pref);
    if (switching) {
      void root.offsetHeight;
      this.doc.defaultView?.getComputedStyle(root).getPropertyValue('color');
      root.classList.remove('fb-theme-switching');
    }
    this.resolved.set(next);
  }
}
