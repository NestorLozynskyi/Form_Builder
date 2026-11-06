import { TestBed } from '@angular/core/testing';
import { ApiError, ApiService } from '../../core/api/api.service';
import { FormDetail } from '../../core/api/models';
import { FormSchema } from '../../core/schema/form-schema';
import { ToastService } from '../../core/ui/toast.service';
import { EditorStore, newBlock } from './editor.store';

const detail = (draft: FormSchema, extra: Partial<FormDetail> = {}): FormDetail => ({
  id: 'f1', title: draft.title, status: 'draft', liveVersion: null, hasUnpublishedChanges: false, responseCount: 0,
  updatedAt: '2026-11-06T00:00:00Z', publicId: null, draft, liveSchema: null, publishBlocker: null, versions: [], createdAt: '', ...extra,
});
const empty = (): FormSchema => ({ title: 'T', description: '', successMessage: 'Thanks', accent: 'cobalt', blocks: [] });

describe('EditorStore', () => {
  let store: EditorStore;
  let saves: FormSchema[];
  let fail = false;

  beforeEach(() => {
    vi.useFakeTimers();
    saves = [];
    fail = false;
    TestBed.configureTestingModule({
      providers: [
        EditorStore,
        ToastService,
        {
          provide: ApiService,
          useValue: {
            saveDraft: async (_id: string, s: FormSchema) => {
              if (fail) throw new ApiError(0, {});
              saves.push(structuredClone(s));
              return detail(s);
            },
            publish: async () => detail(empty(), { status: 'published', liveVersion: 1, publicId: 'p' }),
          },
        },
      ],
    });
    store = TestBed.inject(EditorStore);
    store.init(detail(empty()));
  });
  afterEach(() => vi.useRealTimers());

  it('adds, moves, duplicates and removes blocks with stable unique ids', () => {
    const a = store.add('short');
    const b = store.add('email');
    store.move(b.id, 0);
    expect(store.blocks().map((x) => x.id)).toEqual([b.id, a.id]);
    const c = store.duplicate(a.id)!;
    expect(c.id).not.toBe(a.id);
    expect(store.blocks()).toHaveLength(3);
    store.remove(a.id);
    expect(store.blocks().map((x) => x.id)).toEqual([b.id, c.id]);
    expect(store.selected()).toBe(c.id);
  });

  it('blocks publishing without inputs or with configuration issues (same rules as the server)', () => {
    expect(store.blocker()).toBe('Add at least one input field to publish');
    store.add('heading');
    expect(store.blocker()).toBe('Add at least one input field to publish');
    const r = store.add('radio');
    expect(store.blocker()).toBe('');
    store.updateBlock(r.id, { options: [''] });
    expect(store.blocker()).toBe('Fix 2 issues to publish');
    store.updateBlock(r.id, { options: ['A', 'B'], pattern: null });
    const s = store.add('short');
    store.updateBlock(s.id, { pattern: '(a+)+$' });
    expect(store.allIssues().map((i) => i.issue.key)).toEqual(['pattern']);
  });

  it('autosaves after a pause: Saving… → Saved, and Save failed keeps retrying', async () => {
    store.add('short');
    expect(store.save()).toBe('saving');
    await vi.advanceTimersByTimeAsync(800);
    expect(saves).toHaveLength(1);
    expect(store.save()).toBe('saved');
    expect(store.dirty()).toBe(false);

    fail = true;
    store.updateForm({ title: 'New title' });
    await vi.advanceTimersByTimeAsync(800);
    expect(store.save()).toBe('failed');
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.save()).toBe('saved');
    expect(saves.at(-1)!.title).toBe('New title');
  });

  it('new blocks get the editor defaults', () => {
    expect(newBlock('scale')).toMatchObject({ type: 'scale', max: 5, label: 'Untitled question', required: false });
    expect(newBlock('checkbox').options).toEqual(['Option 1', 'Option 2']);
    expect(newBlock('heading').label).toBeUndefined();
  });
});
