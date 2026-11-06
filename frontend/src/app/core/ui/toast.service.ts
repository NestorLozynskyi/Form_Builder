import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface ToastOptions {
  type?: ToastType;
  title: string;
  message?: string;
  /** ms; 0 = sticky. Default 5000 (errors 8000). */
  timeout?: number;
  action?: { label: string; onClick: () => void };
}
export interface Toast extends ToastOptions {
  id: number;
  type: ToastType;
  leaving: boolean;
}

/** Toast queue rendered by <app-toast-region> (fb.js FB.toast semantics: max 4 visible, hover pauses). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(o: ToastOptions): { close: () => void } {
    const t: Toast = { ...o, type: o.type ?? 'info', id: ++this.seq, leaving: false };
    this.toasts.update((list) => [...list, t]);
    const live = this.toasts().filter((x) => !x.leaving);
    if (live.length > 4) this.close(live[0].id);
    const timeout = o.timeout ?? (t.type === 'error' ? 8000 : 5000);
    if (timeout > 0) this.schedule(t.id, timeout);
    return { close: () => this.close(t.id) };
  }

  success = (title: string, message?: string) => this.show({ type: 'success', title, message });
  error = (title: string, message?: string, action?: ToastOptions['action']) => this.show({ type: 'error', title, message, action });
  info = (title: string, message?: string) => this.show({ type: 'info', title, message });

  schedule(id: number, ms: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.close(id), ms));
  }

  pause(id: number): void {
    clearTimeout(this.timers.get(id));
  }

  close(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toasts.update((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => this.toasts.update((list) => list.filter((t) => t.id !== id)), 150);
  }
}
