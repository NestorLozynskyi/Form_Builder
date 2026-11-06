import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api.service';
import { AuthService } from '../../core/api/auth.service';
import { Icon } from '../../core/ui/icon';
import { ThemeToggle } from '../../shared/app-header';
import { MSG, emailError, newPasswordError } from './auth-messages';
import { PasswordInput } from './password-input';

type Key = 'email' | 'password' | 'confirm';

/** screens/sign-up.html */
@Component({
  selector: 'app-sign-up',
  imports: [ReactiveFormsModule, RouterLink, Icon, ThemeToggle, PasswordInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.css',
  templateUrl: './sign-up.html',
})
export class SignUpPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
    confirm: new FormControl('', { nonNullable: true }),
  });
  protected readonly errors = signal<Partial<Record<Key, string>>>({});
  protected readonly loading = signal(false);
  protected readonly network = signal(false);
  private readonly emailEl = viewChild<ElementRef<HTMLInputElement>>('email');

  constructor() {
    // Clear a field's error as soon as its value becomes valid (mockup behaviour).
    for (const k of ['email', 'password', 'confirm'] as Key[]) {
      this.form.controls[k].valueChanges.subscribe(() => {
        if (this.errors()[k] && !this.check()[k]) this.errors.update((e) => ({ ...e, [k]: undefined }));
      });
    }
  }

  private check(): Partial<Record<Key, string>> {
    const v = this.form.getRawValue();
    return {
      email: emailError(v.email) ?? undefined,
      password: newPasswordError(v.password) ?? undefined,
      confirm: !v.confirm ? MSG.confirmEmpty : v.confirm !== v.password ? MSG.mismatch : undefined,
    };
  }

  protected async submit(): Promise<void> {
    if (this.loading()) return;
    this.network.set(false);
    const e = this.check();
    this.errors.set(e);
    const first = (['email', 'password', 'confirm'] as Key[]).find((k) => e[k]);
    if (first) {
      document.getElementById('su-' + first)?.focus();
      return;
    }
    this.loading.set(true);
    try {
      const v = this.form.getRawValue();
      await this.auth.signUp(v.email.trim(), v.password);
      await this.router.navigateByUrl('/forms');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const fe = err.fieldErrors();
        this.errors.set({ email: fe['email'], password: fe['password'] });
        this.emailEl()?.nativeElement.focus();
      } else if (err instanceof ApiError && err.status === 429) {
        this.errors.set({ email: 'Too many attempts. Wait a minute and try again.' });
      } else {
        this.network.set(true);
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected isTaken(): boolean {
    return this.errors().email === MSG.taken;
  }
}
