import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppHeader } from '../../shared/app-header';
import { SystemError } from './system-error';

/** /error — screens/error.html as a standalone route. */
@Component({
  selector: 'app-error-page',
  imports: [AppHeader, SystemError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fb-app">
      <app-header [active]="null" />
      <main class="fb-main" id="main">
        <div class="fb-container fb-container--narrow">
          <app-system-error [offline]="offline" [reference]="ref" (retry)="reload()" />
        </div>
      </main>
    </div>
  `,
})
export class ErrorPage {
  protected readonly offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  protected readonly ref = history.state?.ref ?? null;
  protected reload(): void {
    const back = history.state?.from;
    if (back) location.assign(back);
    else location.reload();
  }
}
