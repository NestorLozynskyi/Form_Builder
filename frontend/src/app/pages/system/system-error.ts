import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { copyText } from '../../core/ui/dialog';
import { Icon } from '../../core/ui/icon';
import { ToastService } from '../../core/ui/toast.service';

/** Body of screens/error.html (general error / offline). Pages render it in place when loading fails. */
@Component({
  selector: 'app-system-error',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './system.css',
  template: `
    @if (offline()) {
      <div class="fb-empty sys">
        <div class="fb-empty__icon sys__icon--warning"><svg appIcon="wifi-off"></svg></div>
        <h1 class="fb-empty__title sys__title">You’re offline</h1>
        <p class="fb-empty__text">Form Builder can’t reach the internet, so this page couldn’t load. Check your Wi‑Fi or mobile data connection, then try again.</p>
        <div class="fb-empty__actions">
          <button type="button" class="fb-btn fb-btn--primary" [class.is-loading]="busy()" [attr.aria-busy]="busy() || null" (click)="doRetry()"><svg appIcon="refresh"></svg>Try again</button>
        </div>
      </div>
    } @else {
      <div class="fb-empty sys">
        <div class="fb-empty__icon sys__icon--danger"><svg appIcon="alert-triangle"></svg></div>
        <h1 class="fb-empty__title sys__title">Something went wrong</h1>
        <p class="fb-empty__text">We couldn’t load this page because of a problem on our side. Try again in a moment. If it keeps happening, include the reference code below when you report it.</p>
        @if (reference(); as ref) {
          <div class="sys__ref">
            <span class="sys__ref-label">Reference</span>
            <code class="sys__ref-code">{{ ref }}</code>
            <button type="button" class="fb-btn fb-btn--ghost fb-btn--icon fb-btn--sm" aria-label="Copy reference code" (click)="copy(ref)"><svg appIcon="copy"></svg></button>
          </div>
        }
        <div class="fb-empty__actions">
          <button type="button" class="fb-btn fb-btn--primary" [class.is-loading]="busy()" [attr.aria-busy]="busy() || null" (click)="doRetry()"><svg appIcon="refresh"></svg>Try again</button>
          <a class="fb-btn fb-btn--secondary" routerLink="/forms">Go to Forms</a>
        </div>
      </div>
    }
  `,
})
export class SystemError {
  private readonly toast = inject(ToastService);
  readonly offline = input(false);
  readonly reference = input<string | null>(null);
  readonly retry = output<void>();
  protected readonly busy = signal(false);

  protected doRetry(): void {
    this.busy.set(true);
    this.retry.emit();
    setTimeout(() => this.busy.set(false), 600);
  }

  protected async copy(ref: string): Promise<void> {
    await copyText(ref);
    this.toast.show({ type: 'success', title: 'Reference code copied', timeout: 3000 });
  }
}

/** Short reference code shown to users for a server trace id: "ERR-7F3K-92QD"-style. */
export function referenceCode(traceId: string | undefined | null): string | null {
  if (!traceId) return null;
  return traceId.length > 32 ? traceId.slice(0, 64) : traceId;
}
