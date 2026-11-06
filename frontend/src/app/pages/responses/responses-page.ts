import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ApiError, ApiService, publicUrl } from '../../core/api/api.service';
import { FormDetail, ResponseItem, ResponsePage } from '../../core/api/models';
import { AnswerValue, Block, isInput } from '../../core/schema/form-schema';
import { closeDialog, copyText, openDialog } from '../../core/ui/dialog';
import { dateTime } from '../../core/ui/format';
import { Icon } from '../../core/ui/icon';
import { MenuTrigger } from '../../core/ui/menu';
import { ToastService } from '../../core/ui/toast.service';
import { AppHeader } from '../../shared/app-header';
import { StatusBadges } from '../../shared/status-badges';
import { NotFoundPage } from '../system/not-found';
import { SystemError } from '../system/system-error';

const PAGE_SIZE = 10;

/** /forms/:id/responses — screens/responses.html */
@Component({
  selector: 'app-responses-page',
  imports: [AppHeader, Icon, MenuTrigger, RouterLink, StatusBadges, NotFoundPage, SystemError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './responses-page.css',
  templateUrl: './responses-page.html',
})
export class ResponsesPage implements OnInit {
  readonly id = input.required<string>();
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly title = inject(Title);

  protected readonly form = signal<FormDetail | null>(null);
  protected readonly page = signal<ResponsePage | null>(null);
  protected readonly pageNo = signal(1);
  protected readonly loading = signal(true);
  protected readonly missing = signal(false);
  protected readonly loadError = signal<ApiError | null>(null);
  protected readonly exporting = signal(false);
  protected readonly pending = signal<ResponseItem | null>(null);
  protected readonly deleting = signal(false);
  protected readonly dateTime = dateTime;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDlg');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** First three input fields of the live version become table columns (like the mockup). */
  protected readonly columns = computed<Block[]>(() => {
    // Required questions first (they always have answers), topped up with optional ones; shown in form order.
    const inputs = (this.form()?.liveSchema?.blocks ?? []).filter((b) => isInput(b.type));
    const pick = new Set([...inputs.filter((b) => b.required), ...inputs].slice(0, 3));
    return inputs.filter((b) => pick.has(b));
  });
  protected readonly total = computed(() => this.page()?.total ?? this.form()?.responseCount ?? 0);
  protected readonly link = computed(() => (this.form()?.publicId ? publicUrl(this.form()!.publicId!) : ''));
  protected readonly range = computed(() => {
    const p = this.page();
    if (!p || p.total === 0) return '0';
    const from = (p.page - 1) * p.pageSize + 1;
    return `${from}–${Math.min(p.total, from + p.items.length - 1)}`;
  });
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  ngOnInit(): void {
    const p = Number(history.state?.page);
    if (p > 0) this.pageNo.set(p);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);
    this.loading.set(true);
    try {
      const [f, page] = await Promise.all([this.api.getForm(this.id()), this.api.listResponses(this.id(), this.pageNo(), PAGE_SIZE)]);
      this.form.set(f);
      this.title.setTitle(`Responses · ${f.draft.title} · Form Builder`);
      if (page.items.length === 0 && page.total > 0 && this.pageNo() > 1) {
        this.pageNo.set(Math.ceil(page.total / PAGE_SIZE));
        return this.load();
      }
      this.page.set(page);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) this.missing.set(true);
      else if (!(e instanceof ApiError && e.status === 401)) this.loadError.set(e instanceof ApiError ? e : new ApiError(0, {}));
    } finally {
      this.loading.set(false);
    }
  }

  protected async go(page: number): Promise<void> {
    if (page < 1 || page > this.lastPage()) return;
    this.pageNo.set(page);
    this.loading.set(true);
    try {
      this.page.set(await this.api.listResponses(this.id(), page, PAGE_SIZE));
    } catch {
      this.toast.error('Couldn’t load responses', 'Check your connection and try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected cell(r: ResponseItem, b: Block): string {
    const v: AnswerValue | undefined = r.answers[b.id];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === '') return '';
    return Array.isArray(v) ? v.join('; ') : v;
  }

  protected header(b: Block): string {
    return b.type === 'scale' ? `${b.label} (1–${Math.trunc(b.max ?? 5)})` : (b.label ?? '');
  }

  protected isLive(r: ResponseItem): boolean {
    return r.version === this.form()?.liveVersion;
  }

  protected open(r: ResponseItem, ev?: Event): void {
    if (ev && (ev.target as HTMLElement).closest('a, button')) return;
    void this.router.navigate(['/forms', this.id(), 'responses', r.id]);
  }

  protected async copyLink(): Promise<void> {
    await copyText(this.link());
    this.toast.show({ type: 'success', title: 'Public link copied', timeout: 3000 });
  }

  protected async exportCsv(): Promise<void> {
    if (this.exporting() || this.total() === 0) return;
    this.exporting.set(true);
    const n = this.total();
    const started = this.toast.show({ type: 'success', title: 'CSV export started', message: `Exporting ${n.toLocaleString('en-US')} responses… CSV download started.` });
    try {
      const res = await this.api.exportCsv(this.id());
      const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'responses.csv';
      const url = URL.createObjectURL(res.body!);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      started.close();
      this.toast.show({ type: 'error', title: 'Couldn’t export CSV. Try again.', timeout: 0, action: { label: 'Retry', onClick: () => void this.exportCsv() } });
    } finally {
      this.exporting.set(false);
    }
  }

  protected askDelete(r: ResponseItem, opener: HTMLElement): void {
    this.pending.set(r);
    openDialog(this.dialog().nativeElement, opener);
  }

  protected cancelDelete(): void {
    void closeDialog(this.dialog().nativeElement);
  }

  protected async confirmDelete(): Promise<void> {
    const r = this.pending();
    if (!r || this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.api.deleteResponse(this.id(), r.id);
      await closeDialog(this.dialog().nativeElement, this.heading()?.nativeElement);
      this.toast.success('Response deleted', `Response #${r.number} was permanently deleted.`);
      await this.load();
    } catch (e) {
      await closeDialog(this.dialog().nativeElement);
      if (e instanceof ApiError && e.status === 404) await this.load();
      else this.toast.error('Couldn’t delete response', 'The server didn’t respond, so nothing was deleted. Try again.');
    } finally {
      this.deleting.set(false);
      this.pending.set(null);
    }
  }
}
