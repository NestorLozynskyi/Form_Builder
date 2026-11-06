import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiError, ApiService, publicUrl } from '../../core/api/api.service';
import { FormStatus, FormSummary } from '../../core/api/models';
import { closeDialog, copyText, openDialog } from '../../core/ui/dialog';
import { fullDateTitle, relativeTime } from '../../core/ui/format';
import { Icon } from '../../core/ui/icon';
import { MenuTrigger } from '../../core/ui/menu';
import { ToastService } from '../../core/ui/toast.service';
import { AppHeader } from '../../shared/app-header';
import { StatusBadges } from '../../shared/status-badges';
import { SystemError } from '../system/system-error';

type Filter = 'all' | FormStatus;

/** screens/forms.html — My forms. */
@Component({
  selector: 'app-forms-page',
  imports: [AppHeader, Icon, MenuTrigger, RouterLink, StatusBadges, SystemError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './forms-page.css',
  templateUrl: './forms-page.html',
})
export class FormsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly forms = signal<FormSummary[] | null>(null);
  protected readonly loadError = signal<ApiError | null>(null);
  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly creating = signal(false);
  protected readonly pending = signal<FormSummary | null>(null);
  protected readonly deleting = signal(false);
  protected readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'published', label: 'Published' },
    { key: 'closed', label: 'Closed' },
  ];
  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return (this.forms() ?? []).filter((x) => (!q || x.title.toLowerCase().includes(q)) && (f === 'all' || x.status === f));
  });
  protected readonly relative = relativeTime;
  protected readonly fullDate = fullDateTitle;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');
  private readonly title = viewChild<ElementRef<HTMLElement>>('pageTitle');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.forms.set(await this.api.listForms());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      this.loadError.set(e instanceof ApiError ? e : new ApiError(0, {}));
    }
  }

  protected countText(): string {
    const n = this.forms()?.length ?? 0;
    return `${n} ${n === 1 ? 'form' : 'forms'}`;
  }

  protected clearFilters(): void {
    this.query.set('');
    this.filter.set('all');
    this.search()?.nativeElement.focus();
  }

  protected async create(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    try {
      const f = await this.api.createForm();
      await this.router.navigate(['/forms', f.id, 'edit'], { state: { created: true } });
    } catch {
      this.toast.error('Couldn’t create form', 'The server didn’t respond. Try again.');
    } finally {
      this.creating.set(false);
    }
  }

  protected async copyLink(f: FormSummary): Promise<void> {
    if (!f.publicId) return;
    await copyText(publicUrl(f.publicId));
    this.toast.show({ type: 'success', title: 'Link copied', timeout: 3000 });
  }

  protected askDelete(f: FormSummary, opener: HTMLElement): void {
    this.pending.set(f);
    openDialog(this.dialog().nativeElement, opener);
  }

  protected cancelDelete(): void {
    void closeDialog(this.dialog().nativeElement);
  }

  protected async confirmDelete(): Promise<void> {
    const f = this.pending();
    if (!f || this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.api.deleteForm(f.id);
      await closeDialog(this.dialog().nativeElement, this.title()?.nativeElement);
      this.forms.update((list) => (list ?? []).filter((x) => x.id !== f.id));
      const n = f.responseCount;
      this.toast.success('Form deleted', `“${f.title}”${n > 0 ? ` and its ${n} response${n === 1 ? '' : 's'} were` : ' was'} deleted.`);
    } catch (e) {
      await closeDialog(this.dialog().nativeElement);
      if (e instanceof ApiError && e.status === 404) {
        this.forms.update((list) => (list ?? []).filter((x) => x.id !== f.id));
        this.toast.info('Form already deleted');
      } else {
        this.toast.error('Couldn’t delete form', 'The server didn’t respond, so nothing was deleted. Try again.', { label: 'Try again', onClick: () => this.askDelete(f, this.title()!.nativeElement) });
      }
    } finally {
      this.deleting.set(false);
      this.pending.set(null);
    }
  }

  protected onDialogClose(): void {
    if (!this.deleting()) this.pending.set(null);
  }
}
