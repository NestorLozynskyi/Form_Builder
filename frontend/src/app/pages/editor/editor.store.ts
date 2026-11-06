import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, ApiService } from '../../core/api/api.service';
import { FormDetail } from '../../core/api/models';
import { Block, BlockType, FormSchema, TYPE_META, isInput } from '../../core/schema/form-schema';
import { ConfigIssue, ERR_NO_INPUTS, blockIssues } from '../../core/validation/rules';
import { ToastService } from '../../core/ui/toast.service';

export type SaveState = 'saved' | 'saving' | 'failed';
export type Panel = 'left' | 'right' | null;

const SAVE_DEBOUNCE_MS = 700;
const RETRY_MS = 5000;

/** Random, URL-safe block id (stable across versions once created). */
export function newBlockId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'b' + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

/** Defaults for a new block (editor.html newField). */
export function newBlock(type: BlockType): Block {
  const b: Block = { id: newBlockId(), type };
  if (isInput(type)) Object.assign(b, { label: 'Untitled question', help: '', required: false });
  switch (type) {
    case 'short':
    case 'long':
      Object.assign(b, { minLength: null, maxLength: null, pattern: '', patternMessage: '' });
      break;
    case 'number':
      Object.assign(b, { min: null, max: null, integer: false });
      break;
    case 'date':
      Object.assign(b, { earliest: '', latestMode: 'none', latest: '' });
      break;
    case 'radio':
    case 'dropdown':
      b.options = ['Option 1', 'Option 2'];
      break;
    case 'checkbox':
      Object.assign(b, { options: ['Option 1', 'Option 2'], minSelected: null, maxSelected: null });
      break;
    case 'scale':
      Object.assign(b, { max: 5, leftLabel: '', rightLabel: '' });
      break;
    case 'heading':
      b.text = 'Section heading';
      break;
    case 'description':
      b.text = 'Add some context for the questions that follow.';
      break;
  }
  return b;
}

export const titleOf = (b: Block): string => {
  const t = b.label || b.text || TYPE_META[b.type].name;
  return t.length > 48 ? t.slice(0, 47) + '…' : t;
};

/**
 * Editor state: the local draft (source of truth while editing), autosave to PUT /draft with
 * Saving… / Saved / Save failed (+ automatic retry), and publish / close / reopen.
 */
@Injectable()
export class EditorStore {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly form = signal<FormDetail | null>(null);
  readonly draft = signal<FormSchema | null>(null);
  readonly selected = signal<string | null>(null);
  readonly tab = signal<'field' | 'settings'>('field');
  readonly panel = signal<Panel>(null);
  readonly save = signal<SaveState>('saved');
  readonly announcement = signal('');
  /** true while local edits are not yet confirmed by the server */
  readonly dirty = signal(false);

  private rev = 0;
  private savedRev = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  readonly blocks = computed(() => this.draft()?.blocks ?? []);
  readonly selectedBlock = computed(() => this.blocks().find((b) => b.id === this.selected()) ?? null);
  readonly issuesByBlock = computed(() => {
    const m = new Map<string, ConfigIssue[]>();
    for (const b of this.blocks()) {
      const i = blockIssues(b);
      if (i.length) m.set(b.id, i);
    }
    return m;
  });
  readonly allIssues = computed(() => this.blocks().flatMap((b) => (this.issuesByBlock().get(b.id) ?? []).map((i) => ({ block: b, issue: i }))));
  readonly status = computed(() => this.form()?.status ?? 'draft');
  readonly liveVersion = computed(() => this.form()?.liveVersion ?? null);
  readonly unpublished = computed(() => this.liveVersion() !== null && (this.dirty() || !!this.form()?.hasUnpublishedChanges));
  readonly blocker = computed(() => {
    if (!this.blocks().some((b) => isInput(b.type))) return ERR_NO_INPUTS.replace(/\.$/, '');
    const n = this.allIssues().length;
    if (n) return `Fix ${n} ${n === 1 ? 'issue' : 'issues'} to publish`;
    if (this.status() !== 'draft' && !this.unpublished()) return 'No unpublished changes to publish';
    return '';
  });

  init(f: FormDetail): void {
    this.form.set(f);
    this.draft.set(structuredClone(f.draft));
    this.dirty.set(false);
    this.save.set('saved');
  }

  announce(msg: string): void {
    this.announcement.set('');
    setTimeout(() => this.announcement.set(msg), 30);
  }

  // ------------------------------------------------------------ edits
  /** Applies an immutable change to the draft and schedules autosave. */
  edit(fn: (s: FormSchema) => FormSchema): void {
    const d = this.draft();
    if (!d) return;
    this.draft.set(fn(d));
    this.touch();
  }

  updateBlock(id: string, patch: Partial<Block>): void {
    this.edit((s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  }

  updateForm(patch: Partial<Omit<FormSchema, 'blocks'>>): void {
    this.edit((s) => ({ ...s, ...patch }));
  }

  select(id: string | null): void {
    this.selected.set(id);
    this.tab.set('field');
  }

  add(type: BlockType, at?: number): Block {
    const b = newBlock(type);
    const n = this.blocks().length;
    const i = at === undefined || at > n ? n : Math.max(0, at);
    this.edit((s) => ({ ...s, blocks: [...s.blocks.slice(0, i), b, ...s.blocks.slice(i)] }));
    this.select(b.id);
    this.announce(`${TYPE_META[type].name} added at position ${i + 1}`);
    return b;
  }

  move(id: string, to: number): void {
    const list = [...this.blocks()];
    const i = list.findIndex((b) => b.id === id);
    if (i < 0 || to < 0 || to >= list.length || to === i) return;
    const [b] = list.splice(i, 1);
    list.splice(to, 0, b);
    this.edit((s) => ({ ...s, blocks: list }));
    this.announce(`${titleOf(b)} moved to position ${to + 1} of ${list.length}`);
  }

  duplicate(id: string): Block | null {
    const list = this.blocks();
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const c = { ...structuredClone(list[i]), id: newBlockId() };
    this.edit((s) => ({ ...s, blocks: [...s.blocks.slice(0, i + 1), c, ...s.blocks.slice(i + 1)] }));
    this.select(c.id);
    this.announce(`${titleOf(c)} duplicated`);
    return c;
  }

  private undoToast: { close: () => void } | null = null;

  remove(id: string): void {
    const list = this.blocks();
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return;
    const removed = list[i];
    this.edit((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id) }));
    if (this.selected() === id) {
      const nb = this.blocks()[i] ?? this.blocks()[i - 1];
      this.selected.set(nb?.id ?? null);
    }
    this.undoToast?.close();
    this.undoToast = this.toast.show({
      type: 'info',
      title: 'Field deleted',
      message: `“${titleOf(removed)}” was removed from the form.`,
      timeout: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          this.edit((s) => {
            const at = Math.min(i, s.blocks.length);
            return { ...s, blocks: [...s.blocks.slice(0, at), removed, ...s.blocks.slice(at)] };
          });
          this.select(removed.id);
          this.announce('Field restored');
          this.undoToast = null;
        },
      },
    });
  }

  // ------------------------------------------------------------ autosave
  private touch(): void {
    this.rev++;
    this.dirty.set(true);
    if (this.save() !== 'failed') this.save.set('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** Saves now (used by Retry and before publishing). Resolves when the latest local revision is stored. */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (this.rev === this.savedRev) return this.save() !== 'failed';
    const f = this.form();
    const d = this.draft();
    if (!f || !d) return false;
    const rev = this.rev;
    this.save.set('saving');
    let ok = false;
    this.inFlight = (async () => {
      try {
        const res = await this.api.saveDraft(f.id, d);
        this.savedRev = rev;
        this.form.set({ ...res, draft: this.draft() ?? res.draft });
        ok = true;
        if (this.rev === rev) {
          this.dirty.set(false);
          this.save.set('saved');
          this.announce('All changes saved');
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        this.save.set('failed');
        this.retryTimer = setTimeout(() => void this.flush(), RETRY_MS);
      }
    })();
    await this.inFlight;
    this.inFlight = null;
    if (ok && this.rev !== rev) return this.flush();
    return ok;
  }

  retryNow(): void {
    this.save.set('saving');
    void this.flush();
  }

  dispose(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.rev !== this.savedRev) void this.flush();
    this.undoToast?.close();
  }

  // ------------------------------------------------------------ publish / close / reopen
  async publish(): Promise<FormDetail | null> {
    const ok = await this.flush();
    const f = this.form();
    if (!ok || !f) {
      this.toast.error('Couldn’t publish', 'Your latest changes aren’t saved yet. Check your connection and try again.');
      return null;
    }
    try {
      const res = await this.api.publish(f.id);
      this.form.set({ ...res, draft: this.draft() ?? res.draft });
      this.dirty.set(false);
      return res;
    } catch (e) {
      const msg = e instanceof ApiError ? (e.problem.errors?.['publish']?.[0] ?? e.problem.detail ?? e.problem.title) : null;
      this.toast.error('Couldn’t publish', msg ?? 'The server didn’t respond. Try again.');
      return null;
    }
  }

  async setOpen(open: boolean): Promise<boolean> {
    const f = this.form();
    if (!f) return false;
    try {
      const res = open ? await this.api.reopen(f.id) : await this.api.close(f.id);
      this.form.set({ ...res, draft: this.draft() ?? res.draft });
      return true;
    } catch {
      this.toast.error(open ? 'Couldn’t reopen responses' : 'Couldn’t close responses', 'The server didn’t respond. Try again.');
      return false;
    }
  }
}
