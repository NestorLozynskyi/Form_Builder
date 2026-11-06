import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, inject, input, signal, viewChild } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ApiError, ApiService } from '../../core/api/api.service';
import { PublicForm } from '../../core/api/models';
import { Answers, FormSchema } from '../../core/schema/form-schema';
import { Icon } from '../../core/ui/icon';
import { FormRenderer, SubmitState } from '../../shared/form-renderer/form-renderer';
import { AccentDirective } from './accent.directive';

type View = 'loading' | 'form' | 'success' | 'closed' | 'not-available' | 'error';

/** /f/:publicId — screens/public-form.html (anonymous respondent page). */
@Component({
  selector: 'app-public-form-page',
  imports: [FormRenderer, Icon, AccentDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './public-form-page.css',
  templateUrl: './public-form-page.html',
})
export class PublicFormPage implements OnInit {
  readonly publicId = input.required<string>();
  private readonly api = inject(ApiService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  protected readonly view = signal<View>('loading');
  protected readonly schema = signal<FormSchema | null>(null);
  protected readonly closedTitle = signal('');
  protected readonly closedAccent = signal('cobalt');
  protected readonly version = signal(0);
  protected readonly state = signal<SubmitState>('idle');
  protected readonly retryIn = signal(0);
  protected readonly serverErrors = signal<Record<string, string> | null>(null);
  protected readonly notice = signal<string | null>(null);
  private readonly renderer = viewChild(FormRenderer);
  private readonly successTitle = viewChild<ElementRef<HTMLElement>>('successTitle');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    inject(DestroyRef).onDestroy(() => {
      this.meta.removeTag('name="robots"');
      if (this.timer) clearInterval(this.timer);
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.view.set('loading');
    try {
      this.apply(await this.api.publicForm(this.publicId()));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) this.notAvailable();
      else this.view.set('error');
    }
  }

  private apply(f: PublicForm): void {
    if (f.status === 'closed') {
      this.closedTitle.set(f.title);
      this.closedAccent.set(f.accent || 'cobalt');
      this.title.setTitle(f.title);
      this.view.set('closed');
      return;
    }
    this.schema.set(f.schema);
    this.version.set(f.version);
    this.title.setTitle(f.schema.title);
    this.view.set('form');
  }

  private notAvailable(): void {
    this.title.setTitle('Form not available');
    this.view.set('not-available');
  }

  protected async submit(e: { answers: Answers; website: string }): Promise<void> {
    this.state.set('submitting');
    this.serverErrors.set(null);
    this.notice.set(null);
    try {
      await this.api.submit(this.publicId(), this.version(), e.answers, e.website);
      this.state.set('idle');
      this.view.set('success');
      window.scrollTo(0, 0);
      setTimeout(() => this.successTitle()?.nativeElement.focus());
    } catch (err) {
      if (!(err instanceof ApiError) || err.isNetwork || err.status >= 500) {
        this.state.set('network-error');
      } else if (err.status === 429) {
        this.startCountdown(err.retryAfter ?? 60);
      } else if (err.status === 400) {
        this.state.set('idle');
        this.serverErrors.set(err.fieldErrors());
      } else if (err.status === 409 && err.problem.title === 'Form closed') {
        this.state.set('idle');
        this.closedTitle.set(this.schema()?.title ?? '');
        this.closedAccent.set(this.schema()?.accent ?? 'cobalt');
        this.view.set('closed');
      } else if (err.status === 409) {
        this.state.set('idle');
        this.notice.set(err.problem.detail ?? 'This form was updated. Reload the page to see the latest version.');
      } else if (err.status === 404) {
        this.state.set('idle');
        this.notAvailable();
      } else {
        this.state.set('network-error');
      }
    }
  }

  private startCountdown(sec: number): void {
    if (this.timer) clearInterval(this.timer);
    this.retryIn.set(Math.ceil(sec));
    this.state.set('rate-limited');
    this.timer = setInterval(() => {
      this.retryIn.update((s) => s - 1);
      if (this.retryIn() <= 0) {
        clearInterval(this.timer!);
        this.timer = null;
        this.state.set('idle');
      }
    }, 1000);
  }

  protected again(ev: Event): void {
    ev.preventDefault();
    this.view.set('form');
    setTimeout(() => {
      this.renderer()?.reset();
      window.scrollTo(0, 0);
      (document.querySelector('.fb-form__body input, .fb-form__body textarea, .fb-form__body select') as HTMLElement | null)?.focus();
    });
  }

  protected reload(): void {
    location.reload();
  }
}
