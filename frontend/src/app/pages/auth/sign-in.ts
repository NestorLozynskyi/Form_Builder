import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api.service';
import { AuthService } from '../../core/api/auth.service';
import { Icon } from '../../core/ui/icon';
import { ThemeToggle } from '../../shared/app-header';
import { MSG, emailError } from './auth-messages';

/** screens/sign-in.html */
@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, RouterLink, Icon, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.css',
  templateUrl: './sign-in.html',
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
  });
  protected readonly errors = signal<{ email?: string; password?: string }>({});
  protected readonly loading = signal(false);
  protected readonly invalid = signal(false);
  protected readonly network = signal(false);
  protected readonly rateLimited = signal(false);
  protected readonly signedOut = signal(this.route.snapshot.queryParamMap.has('signedOut'));
  protected readonly shown = signal(false);
  private readonly credAlert = viewChild<ElementRef<HTMLElement>>('cred');

  protected async submit(): Promise<void> {
    if (this.loading()) return;
    this.invalid.set(false);
    this.signedOut.set(false);
    this.network.set(false);
    this.rateLimited.set(false);
    const v = this.form.getRawValue();
    const e = { email: emailError(v.email) ?? undefined, password: v.password ? undefined : MSG.signInPwEmpty };
    this.errors.set(e);
    if (e.email) return document.getElementById('si-email')?.focus();
    if (e.password) return document.getElementById('si-password')?.focus();
    this.loading.set(true);
    try {
      await this.auth.signIn(v.email.trim(), v.password);
      const ret = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(ret && ret.startsWith('/') && !ret.startsWith('//') ? ret : '/forms');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        this.invalid.set(true);
        this.form.controls.password.setValue('');
        setTimeout(() => this.credAlert()?.nativeElement.focus());
      } else if (err instanceof ApiError && err.status === 429) {
        this.rateLimited.set(true);
      } else {
        this.network.set(true);
      }
    } finally {
      this.loading.set(false);
    }
  }
}
