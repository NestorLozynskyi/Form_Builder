import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormControl, FormRecord, ReactiveFormsModule } from '@angular/forms';
import { AnswerValue, Answers, Block, FormSchema, isInput } from '../../core/schema/form-schema';
import { validateAnswer } from '../../core/validation/rules';
import { count, trim } from '../../core/validation/text';
import { todayIso } from '../../core/ui/format';
import { Icon } from '../../core/ui/icon';

export type SubmitState = 'idle' | 'submitting' | 'rate-limited' | 'network-error';

/**
 * Respondent form body (screens/public-form.html, also used by preview.html). Built from the version schema with a
 * Reactive FormGroup; every rule comes from core/validation/rules.ts — the same rules the server runs.
 * Validation timing follows the mockup: on blur once a field is dirty, live while a field shows an error, on change for
 * choices, and everything on submit (with an error summary that links to the questions).
 */
@Component({
  selector: 'app-form-renderer',
  imports: [ReactiveFormsModule, Icon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './form-renderer.css',
  templateUrl: './form-renderer.html',
})
export class FormRenderer {
  readonly schema = input.required<FormSchema>();
  readonly preview = input(false);
  readonly state = input<SubmitState>('idle');
  readonly retryIn = input(0);
  /** Errors from the server (keyed by block id) — shown exactly like client errors. */
  readonly serverErrors = input<Record<string, string> | null>(null);
  readonly submitted = output<{ answers: Answers; website: string }>();

  protected readonly form = new FormRecord<FormControl<AnswerValue>>({});
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly summary = signal<{ id: string; text: string }[]>([]);
  protected readonly honeypot = new FormControl('', { nonNullable: true });
  private readonly dirty = new Set<string>();
  private readonly badInput = new Set<string>();
  private readonly summaryEl = viewChild<ElementRef<HTMLElement>>('summaryBox');
  protected readonly lengths = signal<Record<string, number>>({});
  protected readonly blocks = computed(() => this.schema().blocks);
  /** A description right after a section heading is rendered inside that section (public-form.html markup). */
  protected readonly sectionText = computed(() => {
    const m = new Map<string, string>();
    const bs = this.blocks();
    bs.forEach((b, i) => {
      const n = bs[i + 1];
      if (b.type === 'heading' && n?.type === 'description' && n.text) m.set(b.id, n.id);
    });
    return m;
  });
  protected readonly absorbed = computed(() => new Set(this.sectionText().values()));
  protected textOf(id: string | undefined): string {
    return this.blocks().find((b) => b.id === id)?.text ?? '';
  }
  protected readonly today = todayIso();
  protected readonly count = count;
  protected readonly isInput = isInput;
  protected readonly hasRequired = computed(() => this.schema().blocks.some((b) => isInput(b.type) && b.required));

  constructor() {
    effect(() => this.build(this.schema()));
    effect(() => {
      if (this.state() === 'submitting') this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });
    effect(() => {
      const se = this.serverErrors();
      if (se && Object.keys(se).length) {
        this.errors.set({ ...se });
        this.renderSummary(true);
      }
    });
  }

  private build(s: FormSchema): void {
    for (const k of Object.keys(this.form.controls)) this.form.removeControl(k);
    for (const b of s.blocks) {
      if (!isInput(b.type)) continue;
      this.form.addControl(b.id, new FormControl<AnswerValue>(b.type === 'checkbox' ? [] : '', { nonNullable: true }));
    }
    this.errors.set({});
    this.summary.set([]);
    this.dirty.clear();
    this.badInput.clear();
    this.lengths.set({});
  }

  reset(): void {
    this.build(this.schema());
    this.honeypot.setValue('');
  }

  protected ctl(id: string): FormControl<AnswerValue> {
    return this.form.controls[id];
  }

  protected inputId = (b: Block) => 'pf-' + b.id;
  protected describedBy(b: Block, ...extra: string[]): string | null {
    const ids = [b.help ? `pf-${b.id}-help` : '', ...extra, this.errors()[b.id] ? `pf-${b.id}-err` : ''].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }
  protected options = (b: Block) => b.options ?? [];
  protected scaleItems = (b: Block) => Array.from({ length: Math.trunc(b.max ?? 5) }, (_, i) => String(i + 1));
  protected dateMax(b: Block): string | null {
    if (b.latestMode === 'today') return this.today;
    if (b.latestMode === 'date' && b.latest) return b.latest;
    return null;
  }

  /** Raw answer as the API expects it: strings / string[] (number inputs report numbers through the value accessor). */
  private valueOf(b: Block): AnswerValue {
    const v = this.ctl(b.id).getRawValue() as AnswerValue | number | null;
    if (v === null || v === undefined) return '';
    return typeof v === 'number' ? String(v) : v;
  }

  private check(b: Block): string | null {
    if (this.badInput.has(b.id)) return validateAnswer(b, '\u0000', this.today).error;
    return validateAnswer(b, this.valueOf(b), this.today).error;
  }

  private setError(b: Block, msg: string | null): void {
    this.errors.update((e) => {
      const n = { ...e };
      if (msg) n[b.id] = msg;
      else delete n[b.id];
      return n;
    });
  }

  private validate(b: Block): string | null {
    const m = this.check(b);
    this.setError(b, m);
    return m;
  }

  private renderSummary(force = false): number {
    if (!force && this.summary().length === 0) return 0;
    const list = this.blocks()
      .filter((b) => this.errors()[b.id])
      .map((b) => ({ id: b.type === 'scale' || b.type === 'radio' || b.type === 'checkbox' ? `pf-${b.id}-0` : this.inputId(b), text: `${trim(b.label).replace(/[?.]$/, '')}: ${this.errors()[b.id]}` }));
    this.summary.set(list);
    return list.length;
  }

  // ---- live behaviour
  protected onInput(b: Block, ev: Event): void {
    const el = ev.target as HTMLInputElement | HTMLTextAreaElement;
    this.dirty.add(b.id);
    if ('validity' in el && el.validity?.badInput) this.badInput.add(b.id);
    else this.badInput.delete(b.id);
    if (b.type === 'long' || b.type === 'short') this.lengths.update((l) => ({ ...l, [b.id]: el.value.length }));
    if (this.errors()[b.id]) {
      this.validate(b);
      this.renderSummary();
    }
  }

  protected onBlur(b: Block, ev: FocusEvent): void {
    const box = (ev.target as HTMLElement).closest('[data-field]');
    if (box && ev.relatedTarget instanceof Node && box.contains(ev.relatedTarget)) return;
    if (!this.dirty.has(b.id) && !this.errors()[b.id]) return;
    this.validate(b);
    this.renderSummary();
  }

  protected onChoice(b: Block): void {
    this.dirty.add(b.id);
    this.validate(b);
    this.renderSummary();
  }

  protected isChecked(b: Block, opt: string): boolean {
    const v = this.ctl(b.id).value;
    return Array.isArray(v) && v.includes(opt);
  }

  protected toggle(b: Block, opt: string, on: boolean): void {
    const v = (this.ctl(b.id).value as string[]) ?? [];
    const next = on ? [...v, opt] : v.filter((x) => x !== opt);
    // keep the author's option order
    this.ctl(b.id).setValue(this.options(b).filter((o) => next.includes(o)));
    this.onChoice(b);
  }

  protected goTo(id: string, ev: Event): void {
    ev.preventDefault();
    const el = document.getElementById(id);
    el?.closest('[data-field]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }

  protected submit(): void {
    if (this.state() === 'submitting' || this.state() === 'rate-limited') return;
    for (const b of this.blocks()) if (isInput(b.type)) this.validate(b);
    if (this.renderSummary(true)) {
      setTimeout(() => {
        this.summaryEl()?.nativeElement.focus();
        this.summaryEl()?.nativeElement.scrollIntoView?.({ block: 'start' });
      });
      return;
    }
    const answers: Answers = {};
    for (const b of this.blocks()) {
      if (!isInput(b.type)) continue;
      const v = this.valueOf(b);
      if (Array.isArray(v) ? v.length : trim(v)) answers[b.id] = v;
    }
    this.submitted.emit({ answers, website: this.honeypot.value });
  }

  protected countdown(): string {
    const s = Math.max(0, this.retryIn());
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
