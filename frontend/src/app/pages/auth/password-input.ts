import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { Icon } from '../../core/ui/icon';

/** Password input with show/hide toggle (`.pw` in the auth mockups). */
@Component({
  selector: 'app-password-input',
  imports: [ReactiveFormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.css',
  host: { class: 'pw' },
  template: `
    <input
      class="fb-input"
      [id]="inputId()"
      [type]="shown() ? 'text' : 'password'"
      [attr.autocomplete]="autocomplete()"
      [formControl]="control()"
      [readOnly]="readonly()"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="describedBy() || null"
    />
    <button
      type="button"
      class="fb-btn fb-btn--ghost fb-btn--icon fb-btn--sm pw__toggle"
      [attr.aria-controls]="inputId()"
      [attr.aria-pressed]="shown()"
      [attr.aria-label]="shown() ? 'Hide password' : 'Show password'"
      (click)="shown.set(!shown())"
    >
      <svg [appIcon]="shown() ? 'eye-off' : 'eye'"></svg>
    </button>
  `,
})
export class PasswordInput {
  readonly inputId = input.required<string>();
  readonly control = input.required<FormControl<string>>();
  readonly autocomplete = input('current-password');
  readonly readonly = input(false);
  readonly error = input<string | null>(null);
  readonly describedBy = input<string>('');
  protected readonly shown = signal(false);
}
