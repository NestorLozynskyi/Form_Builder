import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/api/auth.service';
import { Icon } from '../../core/ui/icon';
import { AppHeader } from '../../shared/app-header';

/** screens/404.html */
@Component({
  selector: 'app-not-found',
  imports: [AppHeader, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './system.css',
  template: `
    <div class="fb-app">
      <app-header [active]="null" />
      <main class="fb-main" id="main">
        <div class="fb-container fb-container--narrow">
          <div class="fb-empty sys">
            <div class="fb-empty__icon"><svg appIcon="help-circle"></svg></div>
            <p class="sys__code">Error 404</p>
            <h1 class="fb-empty__title sys__title">Page not found</h1>
            <p class="fb-empty__text">This page doesn’t exist or may have moved. Check the address for typos, or go back to your forms.</p>
            <div class="fb-empty__actions">
              <a class="fb-btn fb-btn--primary" [routerLink]="auth.user() ? '/forms' : '/sign-in'"><svg appIcon="arrow-left"></svg>Go to Forms</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  `,
})
export class NotFoundPage {
  protected readonly auth = inject(AuthService);
}
