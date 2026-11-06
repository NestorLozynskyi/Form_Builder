import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/api/auth.service';
import { Icon } from '../core/ui/icon';
import { MenuTrigger } from '../core/ui/menu';
import { ThemeService } from '../core/ui/theme.service';

@Component({
  selector: 'app-theme-toggle',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="fb-btn fb-btn--ghost fb-btn--icon" data-action="toggle-theme" [attr.aria-label]="theme.label()" [attr.title]="theme.label()" (click)="theme.cycle()">
      <svg [appIcon]="theme.icon()"></svg>
    </button>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
}

@Component({
  selector: 'app-account-menu',
  imports: [Icon, MenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.user(); as u) {
      <div class="fb-account fb-menu-anchor">
        <button type="button" class="fb-account__trigger" appMenuTrigger [attr.aria-label]="'Account menu for ' + u.email">
          <span class="fb-avatar fb-avatar--sm" aria-hidden="true">{{ auth.initials() }}</span>
          <svg class="icon--sm" appIcon="chevron-down"></svg>
        </button>
        <div class="fb-menu" role="menu" hidden>
          <div class="fb-menu__header"><span class="fb-menu__label">Signed in as</span><span class="fb-menu__email">{{ u.email }}</span></div>
          <hr class="fb-menu__sep" />
          <button type="button" class="fb-menu__item" role="menuitem" (click)="auth.signOut()"><svg appIcon="log-out"></svg>Sign out</button>
        </div>
      </div>
    }
  `,
})
export class AccountMenu {
  protected readonly auth = inject(AuthService);
}

/** App header (logo, primary nav, theme toggle, account menu) — screens/forms.html "Header & account menu". */
@Component({
  selector: 'app-header',
  imports: [RouterLink, Icon, ThemeToggle, AccountMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="fb-header">
      <div class="fb-header__inner fb-container">
        <a class="fb-logo" routerLink="/forms" aria-label="Form Builder — Forms">
          <svg class="fb-logo__mark" appIcon="logo"></svg>
          <span class="fb-logo__word">Form Builder</span>
        </a>
        @if (auth.user()) {
          <nav class="fb-nav" aria-label="Primary">
            <a class="fb-nav__link" routerLink="/forms" [attr.aria-current]="active() === 'forms' ? 'page' : null">Forms</a>
          </nav>
        }
        <div class="fb-header__actions">
          <app-theme-toggle />
          @if (auth.user()) {
            <app-account-menu />
          }
        </div>
      </div>
    </header>
  `,
})
export class AppHeader {
  protected readonly auth = inject(AuthService);
  readonly active = input<'forms' | null>('forms');
}
