import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from './icon';
import { Toast, ToastService } from './toast.service';

const ICON = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' } as const;

@Component({
  selector: 'app-toast-region',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fb-toast-region" aria-live="polite" aria-relevant="additions">
      @for (t of toasts.toasts(); track t.id) {
        <div
          class="fb-toast fb-toast--{{ t.type }}"
          [class.is-leaving]="t.leaving"
          [attr.role]="t.type === 'error' ? 'alert' : 'status'"
          (mouseenter)="toasts.pause(t.id)"
          (mouseleave)="resume(t)"
        >
          <svg class="fb-toast__icon" [appIcon]="icon[t.type]"></svg>
          <div class="fb-toast__content">
            <p class="fb-toast__title">{{ t.title }}</p>
            @if (t.message) {
              <p class="fb-toast__message">{{ t.message }}</p>
            }
            @if (t.action) {
              <button type="button" class="fb-btn fb-btn--link fb-btn--sm fb-toast__action" (click)="act(t)">{{ t.action.label }}</button>
            }
          </div>
          <button type="button" class="fb-btn fb-btn--ghost fb-btn--icon fb-btn--sm fb-toast__close" aria-label="Dismiss notification" (click)="toasts.close(t.id)">
            <svg appIcon="x"></svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastRegion {
  protected readonly toasts = inject(ToastService);
  protected readonly icon = ICON;

  protected resume(t: Toast): void {
    if ((t.timeout ?? 1) !== 0 && !t.leaving) this.toasts.schedule(t.id, 2000);
  }

  protected act(t: Toast): void {
    try {
      t.action?.onClick();
    } finally {
      this.toasts.close(t.id);
    }
  }
}
