import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Block } from '../../core/schema/form-schema';
import { Icon } from '../../core/ui/icon';

/** Non-interactive preview of a block on the canvas (editor.html previewHTML). */
@Component({
  selector: 'app-block-preview',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let b = block();
    @switch (b.type) {
      @case ('heading') { <h3 class="fb-h3">{{ b.text || 'Section heading' }}</h3> }
      @case ('description') { <p class="fb-muted ed-pre">{{ b.text }}</p> }
      @default {
        <div class="fb-field">
          <p class="fb-label">{{ b.label || 'Untitled question' }}@if (b.required) { {{ ' ' }}<span class="fb-req" aria-hidden="true">*</span> }</p>
          @if (b.help) { <p class="fb-help">{{ b.help }}</p> }
          @switch (b.type) {
            @case ('short') { <input class="fb-input" tabindex="-1" placeholder="Short answer" /> }
            @case ('long') { <textarea class="fb-input fb-textarea" tabindex="-1" rows="2" placeholder="Long answer"></textarea> }
            @case ('email') { <input class="fb-input" tabindex="-1" placeholder="name@example.com" /> }
            @case ('number') { <input class="fb-input" tabindex="-1" placeholder="0" /> }
            @case ('date') { <div class="fb-input-wrap fb-input-wrap--trailing"><input class="fb-input" tabindex="-1" placeholder="YYYY-MM-DD" /><svg appIcon="calendar"></svg></div> }
            @case ('dropdown') { <div class="fb-select"><select class="fb-input" tabindex="-1"><option>Select an option</option></select></div> }
            @case ('scale') {
              <div class="fb-scale">
                @for (i of scale(); track i) { <label class="fb-scale__item"><input type="radio" tabindex="-1" /><span>{{ i }}</span></label> }
              </div>
              @if (b.leftLabel || b.rightLabel) { <div class="fb-scale__ends"><span>{{ b.leftLabel }}</span><span>{{ b.rightLabel }}</span></div> }
            }
            @default {
              <div class="fb-choices">
                @for (o of b.options ?? []; track $index) {
                  <label class="fb-choice">
                    <input [type]="b.type === 'radio' ? 'radio' : 'checkbox'" [class]="b.type === 'radio' ? 'fb-radio' : 'fb-checkbox'" tabindex="-1" />
                    <span>@if (o.trim()) { {{ o }} } @else { <span class="ed-empty-opt">Empty option</span> }</span>
                  </label>
                }
              </div>
            }
          }
        </div>
      }
    }
  `,
})
export class BlockPreview {
  readonly block = input.required<Block>();
  protected readonly scale = computed(() => Array.from({ length: Math.trunc(this.block().max ?? 5) }, (_, i) => i + 1));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d: string) => {
  const p = d.split('-');
  return p.length === 3 ? `${MONTHS[+p[1] - 1]} ${+p[2]}, ${p[0]}` : d;
};
const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : v);
function rangeTxt(a: number | null, b: number | null, unit: string): string {
  if (a !== null && b !== null) return `${a}–${b}${unit}`;
  if (b !== null) return `Up to ${b}${unit}`;
  if (a !== null) return `At least ${a}${unit}`;
  return '';
}

/** Rule summary caption under a block ("Required · 2–80 characters · Custom pattern"). */
export function rulesText(f: Block): string {
  const r: string[] = [];
  const t = f.type;
  if (t === 'heading' || t === 'description') return '';
  if (f.required) r.push('Required');
  if (t === 'short' || t === 'long') {
    const lt = rangeTxt(num(f.minLength), num(f.maxLength), ' characters');
    if (lt) r.push(lt);
    if (f.pattern) r.push('Custom pattern');
  }
  if (t === 'email') r.push('Email format');
  if (t === 'number') {
    const nr = rangeTxt(num(f.min), num(f.max), '');
    if (nr) r.push(nr);
    if (f.integer) r.push('Whole numbers only');
  }
  if (t === 'date') {
    const to = f.latestMode === 'today' ? 'today' : f.latestMode === 'date' && f.latest ? fmtDate(f.latest) : '';
    if (f.earliest && to) r.push(`${fmtDate(f.earliest)} – ${to}`);
    else if (f.earliest) r.push(`From ${fmtDate(f.earliest)}`);
    else if (to) r.push(`Up to ${to}`);
  }
  if (t === 'checkbox') {
    const sr = rangeTxt(num(f.minSelected), num(f.maxSelected), '');
    if (sr) r.push('Choose ' + sr.charAt(0).toLowerCase() + sr.slice(1));
  }
  if (t === 'scale') r.push(`1–${Math.trunc(f.max ?? 5)}`);
  if (t === 'dropdown' || t === 'radio' || t === 'checkbox') {
    const n = (f.options ?? []).length;
    r.push(`${n} ${n === 1 ? 'option' : 'options'}`);
  }
  return r.join(' · ');
}
