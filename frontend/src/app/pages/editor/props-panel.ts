import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Block, LatestMode, TYPE_META, isInput } from '../../core/schema/form-schema';
import { Icon } from '../../core/ui/icon';
import { EditorStore } from './editor.store';

const numOrNull = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Properties panel for the selected block (editor.html renderProps / typeHTML). */
@Component({
  selector: 'app-props-panel',
  imports: [Icon, CdkDropList, CdkDrag, CdkDragHandle, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './props-panel.html',
})
export class PropsPanel {
  protected readonly s = inject(EditorStore);
  protected readonly meta = TYPE_META;
  protected readonly isInput = isInput;
  protected readonly scaleTo = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  protected readonly errs = computed(() => {
    const b = this.s.selectedBlock();
    const m: Record<string, string> = {};
    if (b) for (const i of this.s.issuesByBlock().get(b.id) ?? []) m[i.key] = i.message;
    return m;
  });
  protected readonly index = computed(() => this.s.blocks().findIndex((b) => b.id === this.s.selected()));

  protected set(b: Block, patch: Partial<Block>): void {
    this.s.updateBlock(b.id, patch);
  }
  protected text(b: Block, key: keyof Block, ev: Event): void {
    this.set(b, { [key]: (ev.target as HTMLInputElement).value } as Partial<Block>);
  }
  protected num(b: Block, key: keyof Block, ev: Event): void {
    this.set(b, { [key]: numOrNull((ev.target as HTMLInputElement).value) } as Partial<Block>);
  }
  protected check(b: Block, key: keyof Block, ev: Event): void {
    this.set(b, { [key]: (ev.target as HTMLInputElement).checked } as Partial<Block>);
  }
  protected latestMode(b: Block, ev: Event): void {
    this.set(b, { latestMode: (ev.target as HTMLSelectElement).value as LatestMode });
  }
  protected scaleMax(b: Block, ev: Event): void {
    this.set(b, { max: Number((ev.target as HTMLSelectElement).value) });
  }

  protected option(b: Block, i: number, ev: Event): void {
    const o = [...(b.options ?? [])];
    o[i] = (ev.target as HTMLInputElement).value;
    this.set(b, { options: o });
  }
  protected addOption(b: Block): void {
    const o = [...(b.options ?? [])];
    o.push(`Option ${o.length + 1}`);
    this.set(b, { options: o });
    setTimeout(() => {
      const el = document.getElementById(`p-opt-${o.length - 1}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }
  protected removeOption(b: Block, i: number): void {
    const o = (b.options ?? []).filter((_, k) => k !== i);
    this.set(b, { options: o });
    this.s.announce('Option removed');
    setTimeout(() => (document.getElementById(`p-opt-${Math.min(i, o.length - 1)}`) ?? document.getElementById('p-addopt'))?.focus());
  }
  protected dropOption(b: Block, e: CdkDragDrop<unknown>): void {
    if (e.previousIndex === e.currentIndex) return;
    const o = [...(b.options ?? [])];
    moveItemInArray(o, e.previousIndex, e.currentIndex);
    this.set(b, { options: o });
    this.s.announce('Option order updated');
  }
  protected optionKey(b: Block, i: number, e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    const o = [...(b.options ?? [])];
    if (j < 0 || j >= o.length) return;
    moveItemInArray(o, i, j);
    this.set(b, { options: o });
    this.s.announce(`Option moved to position ${j + 1}`);
    setTimeout(() => document.getElementById(`p-opt-grip-${j}`)?.focus());
  }

  protected describedBy(...ids: (string | false | null | undefined)[]): string | null {
    const v = ids.filter(Boolean).join(' ');
    return v || null;
  }
}
