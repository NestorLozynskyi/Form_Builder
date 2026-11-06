import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../../core/api/api.service';
import { FormDetail, ResponseDetail } from '../../core/api/models';
import { AnswerValue, Block, TYPE_META, isInput } from '../../core/schema/form-schema';
import { closeDialog, openDialog } from '../../core/ui/dialog';
import { dateTime, longIsoDate } from '../../core/ui/format';
import { Icon } from '../../core/ui/icon';
import { ToastService } from '../../core/ui/toast.service';
import { AppHeader } from '../../shared/app-header';
import { NotFoundPage } from '../system/not-found';
import { SystemError } from '../system/system-error';

interface Row {
  block: Block;
  /** answer as submitted (undefined = not answered) */
  value: AnswerValue | undefined;
  /** field exists in the live version but not in the version the response was submitted to */
  missing: boolean;
  /** field is in the submitted version but not in the live version */
  removedIn: number | null;
}
interface Group {
  heading: Block | null;
  rows: Row[];
}

/** /forms/:id/responses/:responseId — screens/response-detail.html */
@Component({
  selector: 'app-response-detail-page',
  imports: [AppHeader, Icon, RouterLink, NotFoundPage, SystemError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './response-detail-page.css',
  templateUrl: './response-detail-page.html',
})
export class ResponseDetailPage {
  readonly id = input.required<string>();
  readonly responseId = input.required<string>();
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly title = inject(Title);

  protected readonly form = signal<FormDetail | null>(null);
  protected readonly r = signal<ResponseDetail | null>(null);
  protected readonly notFound = signal(false);
  protected readonly formMissing = signal(false);
  protected readonly loadError = signal<ApiError | null>(null);
  protected readonly deleting = signal(false);
  protected readonly meta = TYPE_META;
  protected readonly dateTime = dateTime;
  protected readonly longDate = longIsoDate;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDlg');

  protected readonly live = computed(() => this.form()?.liveVersion ?? null);
  protected readonly isOld = computed(() => !!this.r() && this.live() !== null && this.r()!.version !== this.live());

  /** Blocks of the submitted version (its order), with live-only fields inserted where they sit in the live version. */
  protected readonly groups = computed<Group[]>(() => {
    const r = this.r();
    if (!r) return [];
    const liveBlocks = this.form()?.liveSchema?.blocks ?? [];
    const liveIds = new Set(liveBlocks.map((b) => b.id));
    const own = r.schema.blocks;
    const ownIds = new Set(own.map((b) => b.id));
    const removed = r.removedIn ?? {};
    const merged: { block: Block; missing: boolean }[] = own.map((b) => ({ block: b, missing: false }));
    if (this.isOld()) {
      liveBlocks.forEach((b, i) => {
        if (!isInput(b.type) || ownIds.has(b.id)) return;
        // after the closest preceding live block that is already in the list
        let at = 0;
        for (let k = i - 1; k >= 0; k--) {
          const idx = merged.findIndex((m) => m.block.id === liveBlocks[k].id);
          if (idx >= 0) {
            at = idx + 1;
            break;
          }
        }
        merged.splice(at, 0, { block: b, missing: true });
      });
    }
    const groups: Group[] = [{ heading: null, rows: [] }];
    let pendingDesc: Block | null = null;
    for (const m of merged) {
      const b = m.block;
      if (b.type === 'heading') {
        groups.push({ heading: b, rows: [] });
        pendingDesc = null;
      } else if (b.type === 'description') {
        // a description right after a heading becomes its subtitle; otherwise it starts an untitled section
        const g = groups[groups.length - 1];
        if (g.heading && !g.rows.length && !pendingDesc) {
          pendingDesc = b;
          (g as Group & { desc?: string }).desc = b.text ?? '';
        } else groups.push(Object.assign({ heading: null, rows: [] }, { desc: b.text ?? '' }));
      } else {
        groups[groups.length - 1].rows.push({
          block: b,
          value: m.missing ? undefined : r.answers[b.id],
          missing: m.missing,
          removedIn: !m.missing && this.isOld() && !liveIds.has(b.id) ? (removed[b.id] ?? this.live()) : null,
        });
      }
    }
    return groups.filter((g) => g.heading || g.rows.length || (g as Group & { desc?: string }).desc);
  });

  constructor() {
    effect(() => {
      const rid = this.responseId();
      untracked(() => void this.load(rid));
    });
  }

  protected async load(rid = this.responseId()): Promise<void> {
    this.loadError.set(null);
    this.notFound.set(false);
    try {
      const f = this.form() ?? (await this.api.getForm(this.id()));
      this.form.set(f);
      const r = await this.api.getResponse(this.id(), rid);
      this.r.set(r);
      this.title.setTitle(`Response #${r.number} · ${f.title} · Form Builder`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        if (!this.form()) this.formMissing.set(true);
        else {
          this.r.set(null);
          this.notFound.set(true);
        }
      } else if (!(e instanceof ApiError && e.status === 401)) this.loadError.set(e instanceof ApiError ? e : new ApiError(0, {}));
    }
  }

  protected desc(g: Group): string {
    return (g as Group & { desc?: string }).desc ?? '';
  }
  protected isEmpty(v: AnswerValue | undefined): boolean {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  }
  protected list(v: AnswerValue | undefined): string[] {
    return Array.isArray(v) ? v : v ? [v] : [];
  }
  protected text(v: AnswerValue | undefined): string {
    return Array.isArray(v) ? v.join('; ') : (v ?? '');
  }
  protected scaleEnds(b: Block): string {
    const max = Math.trunc(b.max ?? 5);
    const parts = [b.leftLabel ? `1 = ${b.leftLabel}` : '', b.rightLabel ? `${max} = ${b.rightLabel}` : ''].filter(Boolean);
    return parts.join(' · ');
  }

  protected askDelete(opener: HTMLElement): void {
    openDialog(this.dialog().nativeElement, opener);
  }
  protected cancelDelete(): void {
    void closeDialog(this.dialog().nativeElement);
  }

  protected async confirmDelete(): Promise<void> {
    const r = this.r();
    if (!r || this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.api.deleteResponse(this.id(), r.id);
      await closeDialog(this.dialog().nativeElement);
      this.toast.success('Response deleted', `Response #${r.number} was permanently deleted.`);
      const next = r.nextId ?? r.prevId;
      this.form.update((f) => (f ? { ...f, responseCount: Math.max(0, f.responseCount - 1) } : f));
      if (next) await this.router.navigate(['/forms', this.id(), 'responses', next], { replaceUrl: true });
      else await this.router.navigate(['/forms', this.id(), 'responses'], { replaceUrl: true });
    } catch (e) {
      await closeDialog(this.dialog().nativeElement);
      if (e instanceof ApiError && e.status === 404) this.notFound.set(true);
      else this.toast.error('Couldn’t delete response', 'The server didn’t respond, so nothing was deleted. Try again.');
    } finally {
      this.deleting.set(false);
    }
  }
}
