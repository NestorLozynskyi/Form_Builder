/**
 * Form configuration issues and answer validation — a port of FormRules.cs with identical messages.
 * shared/validation-vectors.json runs against this module (Vitest) and FormRules.cs (xUnit).
 */
import { AnswerValue, Answers, Block, FormSchema, hasOptions, isInput, isText, LIMITS, textHardMax } from '../schema/form-schema';
import { checkPattern, patternMatches } from './safe-pattern';
import { count, formatNumber, isEmail, isIsoDate, parseNumber, shortDate, trim } from './text';

export interface ConfigIssue {
  blockId: string;
  key: string;
  message: string;
}

export const ERR_NO_INPUTS = 'Add at least one input field to publish.';

const plural = (n: number, word: string) => (n === 1 ? word : word + 's');
const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);

export function blockIssues(b: Block): ConfigIssue[] {
  const e: ConfigIssue[] = [];
  const add = (key: string, message: string) => e.push({ blockId: b.id, key, message });
  const t = b.type;
  if (!isInput(t)) return e;

  if (trim(b.label).length === 0) add('label', 'Add a label for this question.');

  if (isText(t)) {
    const hard = textHardMax(t);
    const mn = b.minLength;
    const mx = b.maxLength;
    if ((isNum(mn) && mn < 0) || (isNum(mx) && mx < 0)) add('len', 'Lengths can’t be negative.');
    else if (isNum(mn) && isNum(mx) && mn > mx) add('len', 'Minimum length can’t be greater than maximum length.');
    else if ((isNum(mx) && mx > hard) || (isNum(mn) && mn > hard)) add('len', `Lengths can’t be more than ${count(hard)} characters.`);
    if (b.pattern) {
      const pe = checkPattern(b.pattern);
      if (pe) add('pattern', pe);
    }
  } else if (t === 'number') {
    if (isNum(b.min) && isNum(b.max) && b.min > b.max) add('range', 'Minimum value can’t be greater than maximum value.');
  } else if (t === 'date') {
    const earliestOk = !b.earliest || isIsoDate(b.earliest);
    const latestOk = b.latestMode !== 'date' || isIsoDate(b.latest);
    if (!earliestOk) add('dates', 'Enter the earliest date as a complete date.');
    else if (!latestOk) add('dates', 'Choose the latest date, or set Latest date to No limit.');
    else if (b.earliest && b.latestMode === 'date' && b.earliest > (b.latest as string))
      add('dates', 'Earliest date can’t be after latest date.');
  }

  if (hasOptions(t)) {
    const opts = b.options ?? [];
    for (let i = 0; i < opts.length; i++) {
      const text = trim(opts[i]);
      if (!text) {
        add('opt' + i, `Option ${i + 1} is empty. Enter text or remove it.`);
        continue;
      }
      for (let j = 0; j < i; j++) {
        if (trim(opts[j]) === text) {
          add('opt' + i, `Option ${i + 1} is the same as option ${j + 1}. Use different text.`);
          break;
        }
      }
    }
    if (opts.length < 2) add('opts', 'Add at least 2 options.');
  }

  if (t === 'checkbox') {
    const n = (b.options ?? []).length;
    const mn = b.minSelected;
    const mx = b.maxSelected;
    if ((isNum(mn) && mn < 0) || (isNum(mx) && mx < 0)) add('sel', 'Selection limits can’t be negative.');
    else if (isNum(mn) && isNum(mx) && mn > mx) add('sel', 'Minimum selected can’t be greater than maximum selected.');
    else if ((isNum(mx) && mx > n) || (isNum(mn) && mn > n)) add('sel', 'Selection limits can’t be more than the number of options.');
  }
  return e;
}

export const issues = (s: Pick<FormSchema, 'blocks'>): ConfigIssue[] => s.blocks.flatMap(blockIssues);

export function publishBlocker(s: Pick<FormSchema, 'blocks'>): string | null {
  if (!s.blocks.some((b) => isInput(b.type))) return ERR_NO_INPUTS;
  const n = issues(s).length;
  return n === 0 ? null : `Fix ${n} ${n === 1 ? 'issue' : 'issues'} to publish.`;
}

// ------------------------------------------------------------------ answers

export interface AnswerResult {
  error: string | null;
  value: AnswerValue | null;
}

const scaleMax = (b: Block) => Math.trunc(b.max ?? 5);

export function requiredMessage(b: Block): string {
  switch (b.type) {
    case 'email':
      return 'Enter an email address.';
    case 'number':
      return 'Enter a number.';
    case 'date':
      return 'Enter a date.';
    case 'radio':
    case 'dropdown':
      return 'Choose an option.';
    case 'scale': {
      const l = trim(b.leftLabel);
      const r = trim(b.rightLabel);
      return l && r ? `Choose a rating from 1 (${l}) to ${scaleMax(b)} (${r}).` : `Choose a rating from 1 to ${scaleMax(b)}.`;
    }
    default:
      return 'Enter an answer.';
  }
}

function wrongType(b: Block): string {
  switch (b.type) {
    case 'number':
      return 'Enter a number using digits only, like 25.';
    case 'email':
      return 'Enter an email address like name@example.com.';
    case 'date':
      return 'Enter a complete date.';
    case 'radio':
    case 'dropdown':
      return 'Choose one of the listed options.';
    case 'scale':
      return `Choose a rating from 1 to ${scaleMax(b)}.`;
    default:
      return 'Enter an answer.';
  }
}

const tooLong = (max: number, n: number) => `Use ${count(max)} ${plural(max, 'character')} or fewer — you’re at ${count(n)}.`;
const fail = (error: string): AnswerResult => ({ error, value: null });
const ok = (value: AnswerValue | null): AnswerResult => ({ error: null, value });

/** Validates one answer. `today` is the respondent's local date (YYYY-MM-DD). */
export function validateAnswer(b: Block, value: unknown, today: string): AnswerResult {
  const t = b.type;
  const isNull = value === null || value === undefined;

  if (t === 'checkbox') {
    const options = b.options ?? [];
    const selected: string[] = [];
    if (!isNull) {
      if (!Array.isArray(value)) return fail('Choose from the listed options.');
      for (const el of value) {
        if (typeof el !== 'string') return fail('Choose from the listed options.');
        if (!options.includes(el) || selected.includes(el)) return fail('Choose from the listed options.');
        selected.push(el);
      }
    }
    const n = selected.length;
    if (n === 0) {
      if (!b.required) return ok(null);
      const need = Math.max(1, b.minSelected ?? 0);
      return fail(`Choose at least ${need} ${plural(need, 'option')}.`);
    }
    if (isNum(b.minSelected) && n < b.minSelected) return fail(`Choose at least ${b.minSelected} ${plural(b.minSelected, 'option')}.`);
    if (isNum(b.maxSelected) && n > b.maxSelected) return fail(`Choose no more than ${b.maxSelected} ${plural(b.maxSelected, 'option')}.`);
    return ok(options.filter((o) => selected.includes(o)));
  }

  let raw: string;
  if (isNull) raw = '';
  else if (typeof value === 'string') raw = value;
  else return fail(wrongType(b));

  const v = trim(raw);
  if (!v) return b.required ? fail(requiredMessage(b)) : ok(null);

  switch (t) {
    case 'short':
    case 'long': {
      const n = v.length;
      const hard = textHardMax(t);
      if (n > hard) return fail(tooLong(hard, n));
      if (isNum(b.minLength) && b.minLength > 0 && n < b.minLength)
        return fail(`Use at least ${count(b.minLength)} ${plural(b.minLength, 'character')} — you’re at ${count(n)}.`);
      if (isNum(b.maxLength) && b.maxLength >= 0 && n > b.maxLength) return fail(tooLong(b.maxLength, n));
      if (b.pattern && checkPattern(b.pattern) === null && !patternMatches(b.pattern, v)) {
        const msg = trim(b.patternMessage);
        return fail(msg || 'Enter an answer in the expected format.');
      }
      return ok(v);
    }
    case 'email':
      return v.length > LIMITS.emailMaxValue || !isEmail(v) ? fail('Enter an email address like name@example.com.') : ok(v);
    case 'number': {
      const num = v.length > LIMITS.numberMaxValueLength ? null : parseNumber(v);
      if (num === null) return fail('Enter a number using digits only, like 25.');
      if (b.integer && num !== Math.floor(num)) return fail('Enter a whole number, without decimals.');
      const lo = isNum(b.min) ? b.min : null;
      const hi = isNum(b.max) ? b.max : null;
      if ((lo !== null && num < lo) || (hi !== null && num > hi)) {
        if (lo !== null && hi !== null) return fail(`Enter a number from ${formatNumber(lo)} to ${formatNumber(hi)}.`);
        if (lo !== null) return fail(`Enter a number of at least ${formatNumber(lo)}.`);
        return fail(`Enter a number of at most ${formatNumber(hi as number)}.`);
      }
      return ok(v);
    }
    case 'date': {
      if (!isIsoDate(v)) return fail(b.required ? 'Enter a complete date.' : 'Enter a complete date, or clear the field.');
      const lo = isIsoDate(b.earliest) ? b.earliest : null;
      const hi = b.latestMode === 'today' ? today : b.latestMode === 'date' && isIsoDate(b.latest) ? b.latest : null;
      const hiText = b.latestMode === 'today' ? 'today' : hi === null ? '' : shortDate(hi);
      const tooEarly = lo !== null && v < lo;
      const tooLate = hi !== null && v > hi;
      if (tooEarly || tooLate) {
        if (lo !== null && hi !== null) return fail(`Choose a date between ${shortDate(lo)} and ${hiText}.`);
        if (lo !== null) return fail(`Choose a date on or after ${shortDate(lo)}.`);
        return fail(`Choose a date on or before ${hiText}.`);
      }
      return ok(v);
    }
    case 'radio':
    case 'dropdown':
      return (b.options ?? []).includes(raw) ? ok(raw) : fail('Choose one of the listed options.');
    case 'scale': {
      const max = scaleMax(b);
      const r = /^[0-9]+$/.test(v) ? parseInt(v, 10) : NaN;
      return r >= 1 && r <= max && String(r) === v ? ok(v) : fail(`Choose a rating from 1 to ${max}.`);
    }
    default:
      return ok(null);
  }
}

export interface SubmissionResult {
  errors: Record<string, string>;
  answers: Answers;
}

export function validateSubmission(schema: Pick<FormSchema, 'blocks'>, answers: Record<string, unknown>, today: string): SubmissionResult {
  const errors: Record<string, string> = {};
  const normalized: Answers = {};
  for (const b of schema.blocks) {
    if (!isInput(b.type)) continue;
    const r = validateAnswer(b, answers[b.id], today);
    if (r.error) errors[b.id] = r.error;
    else if (r.value !== null) normalized[b.id] = r.value;
  }
  return { errors, answers: normalized };
}
