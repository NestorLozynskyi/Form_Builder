import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { User } from './models';

/** Current session (cookie auth). Loaded once at startup; also primes the XSRF-TOKEN cookie. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly user = signal<User | null>(null);
  readonly loaded = signal(false);
  readonly initials = computed(() => initialsOf(this.user()?.email ?? ''));

  async load(): Promise<void> {
    try {
      const s = await this.api.session();
      this.user.set(s.user);
    } catch {
      this.user.set(null);
    } finally {
      this.loaded.set(true);
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    this.user.set((await this.api.signIn(email, password)).user);
  }

  async signUp(email: string, password: string): Promise<void> {
    this.user.set((await this.api.signUp(email, password)).user);
  }

  async signOut(): Promise<void> {
    try {
      await this.api.signOut();
    } finally {
      this.user.set(null);
      await this.router.navigate(['/sign-in'], { queryParams: { signedOut: 1 } });
    }
  }

  /** Called when any API call returns 401 (session expired). */
  expired(returnUrl: string): void {
    this.user.set(null);
    void this.router.navigate(['/sign-in'], { queryParams: { returnUrl } });
  }
}

/** "alex.morgan@example.com" → "AM"; "anna@x.io" → "AN". The MVP has no name field, so initials come from the email. */
export function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._\-+]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase() || '?';
}
