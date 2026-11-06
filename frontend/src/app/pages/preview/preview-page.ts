import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../../core/api/api.service';
import { FormSchema } from '../../core/schema/form-schema';
import { Icon } from '../../core/ui/icon';
import { ToastService } from '../../core/ui/toast.service';
import { ThemeToggle } from '../../shared/app-header';
import { FormRenderer } from '../../shared/form-renderer/form-renderer';
import { AccentDirective } from '../public/accent.directive';
import { NotFoundPage } from '../system/not-found';
import { SystemError } from '../system/system-error';

/** /forms/:id/preview — screens/preview.html: the current draft as respondents will see it; nothing is sent. */
@Component({
  selector: 'app-preview-page',
  imports: [RouterLink, Icon, ThemeToggle, FormRenderer, AccentDirective, NotFoundPage, SystemError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './preview-page.css',
  template: `
    <div class="fb-app">
      <header class="fb-header pv-bar">
        <div class="fb-header__inner">
          <a class="fb-btn fb-btn--secondary fb-btn--sm" [routerLink]="['/forms', id(), 'edit']"><svg appIcon="arrow-left"></svg><span class="fb-hide-mobile">Back to editor</span><span class="fb-show-mobile">Editor</span></a>
          <p class="pv-bar__msg">
            <svg appIcon="eye"></svg>
            <span class="pv-bar__text fb-hide-mobile"><strong>Preview</strong> — this is how respondents see your form (draft). Responses aren’t saved.</span>
            <span class="pv-bar__text fb-show-mobile"><strong>Preview (draft)</strong> · Responses aren’t saved.</span>
          </p>
          <div class="fb-header__actions"><app-theme-toggle /></div>
        </div>
      </header>
      @if (missing()) {
        <app-not-found />
      } @else if (error()) {
        <main class="fb-main"><div class="fb-container fb-container--narrow"><app-system-error (retry)="load()" /></div></main>
      } @else if (schema(); as s) {
        <main class="fb-public pv-public" [appAccent]="s.accent">
          <app-form-renderer [schema]="s" [preview]="true" (submitted)="previewSubmit()" />
        </main>
      } @else {
        <main class="fb-public pv-public"><div class="pv-loading"><span class="fb-spinner fb-spinner--lg" aria-hidden="true"></span></div></main>
      }
    </div>
  `,
})
export class PreviewPage implements OnInit {
  readonly id = input.required<string>();
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly title = inject(Title);
  protected readonly schema = signal<FormSchema | null>(null);
  protected readonly missing = signal(false);
  protected readonly error = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(false);
    // The editor hands over its in-memory draft (may contain changes still being autosaved).
    const handed = history.state?.draft as FormSchema | undefined;
    if (handed?.blocks) {
      this.schema.set(handed);
      this.title.setTitle(`Preview · ${handed.title} · Form Builder`);
      return;
    }
    try {
      const f = await this.api.getForm(this.id());
      this.schema.set(f.draft);
      this.title.setTitle(`Preview · ${f.draft.title} · Form Builder`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) this.missing.set(true);
      else this.error.set(true);
    }
  }

  protected previewSubmit(): void {
    this.toast.info('Preview only — responses aren’t submitted', 'Publish the form and share its link to collect responses.');
  }
}
