import { TestBed } from '@angular/core/testing';
import { FormSchema } from '../../core/schema/form-schema';
import { FormRenderer } from './form-renderer';

const schema: FormSchema = {
  title: 'Survey <b>bold</b>',
  description: '',
  successMessage: '',
  accent: 'teal',
  blocks: [
    { id: 'name', type: 'short', label: 'Full name', required: true, minLength: 2 },
    { id: 'n', type: 'number', label: 'Count', integer: true },
    { id: 'c', type: 'checkbox', label: 'Pick', options: ['A', 'B', 'C'], minSelected: 1, maxSelected: 2, required: true },
  ],
};

describe('FormRenderer', () => {
  function render() {
    const f = TestBed.createComponent(FormRenderer);
    f.componentRef.setInput('schema', schema);
    f.detectChanges();
    return f;
  }
  const el = (f: ReturnType<typeof render>) => f.nativeElement as HTMLElement;

  it('renders user text as text (no HTML injection)', () => {
    const f = render();
    expect(el(f).querySelector('h1')!.textContent).toBe('Survey <b>bold</b>');
    expect(el(f).querySelector('h1 b')).toBeNull();
  });

  it('shows an error summary with every problem on submit and does not emit', async () => {
    const f = render();
    const emitted = vi.fn();
    f.componentInstance.submitted.subscribe(emitted);
    el(f).querySelector('form')!.dispatchEvent(new Event('submit'));
    f.detectChanges();
    await f.whenStable();
    expect(el(f).querySelector('#pf-summary-title')!.textContent).toContain('Fix 2 problems to submit');
    expect(Array.from(el(f).querySelectorAll('.fb-error')).map((e) => e.textContent!.trim())).toEqual(['Enter an answer.', 'Choose at least 1 option.']);
    expect(emitted).not.toHaveBeenCalled();
  });

  it('emits normalized string answers (numbers as text) and the honeypot separately', () => {
    const f = render();
    const emitted = vi.fn();
    f.componentInstance.submitted.subscribe(emitted);
    const name = el(f).querySelector<HTMLInputElement>('#pf-name')!;
    name.value = 'Anna';
    name.dispatchEvent(new Event('input'));
    const n = el(f).querySelector<HTMLInputElement>('#pf-n')!;
    n.value = '12';
    n.dispatchEvent(new Event('input'));
    const box = el(f).querySelector<HTMLInputElement>('#pf-c-1')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    el(f).querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(emitted).toHaveBeenCalledWith({ answers: { name: 'Anna', n: '12', c: ['B'] }, website: '' });
  });
});
