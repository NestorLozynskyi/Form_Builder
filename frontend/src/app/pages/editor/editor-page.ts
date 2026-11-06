import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDragPreview, CdkDropList, CdkDragHandle } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ApiError, ApiService, publicUrl } from '../../core/api/api.service';
import { AuthService } from '../../core/api/auth.service';
import { FormDetail } from '../../core/api/models';
import { Block, BlockType, INPUT_TYPES, TYPE_META } from '../../core/schema/form-schema';
import { closeDialog, copyText, openDialog } from '../../core/ui/dialog';
import { Icon } from '../../core/ui/icon';
import { MenuTrigger } from '../../core/ui/menu';
import { ThemePref, ThemeService } from '../../core/ui/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { AccountMenu, ThemeToggle } from '../../shared/app-header';
import { AccentDirective } from '../public/accent.directive';
import { NotFoundPage } from '../system/not-found';
import { SystemError } from '../system/system-error';
import { BlockPreview, rulesText } from './block-preview';
import { EditorMeta } from './editor-meta';
import { EditorStore, titleOf } from './editor.store';
import { PropsPanel } from './props-panel';
import { SettingsPanel } from './settings-panel';

type FormFactor = 'desktop' | 'tablet' | 'mobile';
const formFactor = (): FormFactor => (innerWidth >= 1200 ? 'desktop' : innerWidth >= 768 ? 'tablet' : 'mobile');

/** /forms/:id/edit — screens/editor.html */
@Component({
  selector: 'app-editor-page',
  imports: [
    NgTemplateOutlet, RouterLink, Icon, MenuTrigger, ThemeToggle, AccountMenu, AccentDirective, NotFoundPage, SystemError,
    CdkDropList, CdkDrag, CdkDragHandle, CdkDragPreview, CdkDragPlaceholder,
    BlockPreview, EditorMeta, PropsPanel, SettingsPanel,
  ],
  providers: [EditorStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './editor-page.css',
  // Page styles (ed-* classes, from editor.html) are shared by the child panels, so they are not encapsulated.
  encapsulation: ViewEncapsulation.None,
  templateUrl: './editor-page.html',
  host: { '(window:resize)': 'ff.set(formFactor())', '(window:beforeunload)': 'beforeUnload($event)' },
})
export class EditorPage implements OnInit {
  readonly id = input.required<string>();
  protected readonly s = inject(EditorStore);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly title = inject(Title);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  protected readonly formFactor = formFactor;
  protected readonly ff = signal<FormFactor>(formFactor());
  protected readonly missing = signal(false);
  protected readonly loadError = signal<ApiError | null>(null);
  protected readonly meta = TYPE_META;
  protected readonly inputTypes = INPUT_TYPES;
  protected readonly contentTypes: BlockType[] = ['heading', 'description'];
  protected readonly rules = rulesText;
  protected readonly titleOf = titleOf;
  /** palette slot kept visible while its item is dragged out (CDK moves the original element) */
  protected readonly ghostType = signal<BlockType | null>(null);
  protected readonly dragging = signal(false);
  protected readonly publishing = signal(false);
  protected readonly closing = signal(false);
  protected readonly published = signal<{ first: boolean; version: number } | null>(null);
  protected readonly publishPlan = signal<{ first: boolean; next: number } | null>(null);

  private readonly publishDlg = viewChild.required<ElementRef<HTMLDialogElement>>('publishDlg');
  private readonly publishedDlg = viewChild.required<ElementRef<HTMLDialogElement>>('publishedDlg');
  private readonly closeDlg = viewChild.required<ElementRef<HTMLDialogElement>>('closeDlg');
  private readonly publishBtn = viewChild<ElementRef<HTMLElement>>('publishBtn');

  protected readonly publishLabel = computed(() => (this.s.status() === 'draft' ? 'Publish' : 'Publish changes'));
  protected readonly link = computed(() => (this.s.form()?.publicId ? publicUrl(this.s.form()!.publicId!) : ''));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.s.dispose());
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);
    try {
      const f = await this.api.getForm(this.id());
      this.s.init(f);
      this.title.setTitle(`Editor · ${f.draft.title} · Form Builder`);
      // New drafts open with the empty canvas and nothing selected; existing forms select the first block on desktop.
      const first = f.draft.blocks[0];
      if (first && formFactor() === 'desktop') this.s.selected.set(first.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) this.missing.set(true);
      else if (!(e instanceof ApiError && e.status === 401)) this.loadError.set(e instanceof ApiError ? e : new ApiError(0, {}));
    }
  }

  protected beforeUnload(e: BeforeUnloadEvent): void {
    if (this.s.dirty()) {
      void this.s.flush();
      e.preventDefault();
    }
  }

  // ------------------------------------------------------------ title
  protected onTitle(ev: Event): void {
    this.s.updateForm({ title: (ev.target as HTMLInputElement).value });
  }

  // ------------------------------------------------------------ panels
  protected openPanel(p: 'left' | 'right'): void {
    this.s.panel.set(this.s.panel() === p ? null : p);
  }
  protected closePanels(): void {
    this.s.panel.set(null);
  }

  // ------------------------------------------------------------ canvas
  protected add(type: BlockType, at?: number): void {
    const b = this.s.add(type, at);
    if (this.ff() === 'mobile') this.closePanels();
    this.focusBlock(b.id);
  }

  protected selectBlock(b: Block, ev?: Event): void {
    if (ev && (ev.target as HTMLElement).closest('[data-act]')) return;
    const changed = this.s.selected() !== b.id || this.s.tab() !== 'field';
    if (changed) this.s.select(b.id);
    if (this.ff() === 'tablet') this.s.panel.set('right');
  }

  protected blockKey(b: Block, e: KeyboardEvent): void {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.selectBlock(b);
    }
  }

  protected gripKey(b: Block, i: number, e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    this.move(b, i + (e.key === 'ArrowUp' ? -1 : 1), 'grip');
  }

  protected move(b: Block, to: number, act: string): void {
    this.s.move(b.id, to);
    this.focusBlock(b.id, act);
  }

  protected duplicate(b: Block): void {
    const c = this.s.duplicate(b.id);
    if (c) this.focusBlock(c.id);
  }

  protected remove(b: Block): void {
    this.s.remove(b.id);
    const sel = this.s.selected();
    if (sel && this.ff() !== 'mobile') this.focusBlock(sel);
  }

  protected openSettings(): void {
    this.s.tab.set('settings');
    if (this.ff() !== 'desktop') this.s.panel.set('right');
    else setTimeout(() => document.getElementById('s-title')?.focus());
  }

  protected jump(id: string): void {
    this.s.select(id);
    if (this.ff() !== 'desktop') this.s.panel.set(this.ff() === 'tablet' ? 'right' : null);
    this.focusBlock(id);
  }

  private focusBlock(id: string, act?: string): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.fb-block[data-id="${id}"]`);
      if (!el) return;
      let t = act ? el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`) : null;
      if (t?.disabled) t = el.querySelector<HTMLButtonElement>('[data-act="grip"]');
      (t ?? el).focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // ------------------------------------------------------------ drag & drop (CDK)
  protected noEnter = () => false;

  protected paletteExited(type: BlockType): void {
    this.ghostType.set(type);
  }
  protected dragStarted(): void {
    this.dragging.set(true);
  }
  protected dragEnded(): void {
    this.ghostType.set(null);
    this.dragging.set(false);
  }

  protected dropOnCanvas(e: CdkDragDrop<Block[], unknown, BlockType | Block>): void {
    this.ghostType.set(null);
    this.dragging.set(false);
    if (e.previousContainer !== e.container) {
      this.add(e.item.data as BlockType, e.currentIndex);
    } else if (e.previousIndex !== e.currentIndex) {
      const b = e.item.data as Block;
      this.s.move(b.id, e.currentIndex);
      this.s.selected.set(b.id);
    }
  }

  // ------------------------------------------------------------ publish / close / reopen
  protected clickPublish(): void {
    const r = this.s.blocker();
    if (r) {
      this.toast.show({ type: 'warning', title: r, timeout: 4000 });
      return;
    }
    const first = this.s.status() === 'draft';
    this.publishPlan.set({ first, next: first ? 1 : (this.s.liveVersion() ?? 0) + 1 });
    openDialog(this.publishDlg().nativeElement, this.publishBtn()?.nativeElement);
  }

  protected async confirmPublish(): Promise<void> {
    const plan = this.publishPlan();
    if (!plan || this.publishing()) return;
    this.publishing.set(true);
    const res = await this.s.publish();
    this.publishing.set(false);
    await closeDialog(this.publishDlg().nativeElement);
    if (!res) return;
    this.published.set({ first: plan.first, version: res.liveVersion ?? plan.next });
    setTimeout(() => openDialog(this.publishedDlg().nativeElement, this.publishBtn()?.nativeElement), 180);
  }

  protected askClose(opener?: HTMLElement): void {
    openDialog(this.closeDlg().nativeElement, opener);
  }

  protected async confirmClose(): Promise<void> {
    if (this.closing()) return;
    this.closing.set(true);
    const ok = await this.s.setOpen(false);
    this.closing.set(false);
    await closeDialog(this.closeDlg().nativeElement);
    if (ok) this.toast.show({ type: 'warning', title: 'Responses closed', message: 'People who open the link see a closed message.' });
  }

  protected async reopen(): Promise<void> {
    if (await this.s.setOpen(true)) this.toast.success('Responses reopened', 'The form is accepting responses again.');
  }

  protected closeDialogEl(d: HTMLDialogElement): void {
    void closeDialog(d);
  }

  protected async copyLink(): Promise<void> {
    await copyText(this.link());
    this.toast.show({ type: 'success', title: 'Public link copied', timeout: 3000 });
  }

  protected preview(): void {
    void this.router.navigate(['/forms', this.id(), 'preview'], { state: { draft: this.s.draft() } });
  }

  protected setTheme(p: ThemePref): void {
    this.theme.set(p);
  }

  protected earlierVersionsNote(v: number): string {
    return `Responses collected earlier stay linked to ${v - 1 > 1 ? `versions v1–v${v - 1}` : 'version v1'}.`;
  }

  protected issueLabel(b: Block): string {
    const n = this.s.issuesByBlock().get(b.id)?.length ?? 0;
    const sel = b.id === this.s.selected();
    return `${TYPE_META[b.type].name}: ${titleOf(b)}${b.required ? ', required' : ''}${n ? `, ${n} ${n === 1 ? 'issue' : 'issues'}` : ''}${sel ? ', selected' : ''}`;
  }

  protected asTypes(t: unknown): BlockType[] {
    return t as BlockType[];
  }

  protected formDetail(): FormDetail | null {
    return this.s.form();
  }
}
