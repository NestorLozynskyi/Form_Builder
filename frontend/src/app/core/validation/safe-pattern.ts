/**
 * Safe regular-expression subset — a line-by-line port of SafePattern.cs (same grammar, same error messages,
 * checked by shared/validation-vectors.json). Matching uses a Thompson NFA simulation, which is linear in the
 * input length, so no pattern can freeze the respondent's browser.
 */
import { WHITESPACE_RANGES, isWhitespace } from './text';

export const MAX_REPEAT = 100;
export const MAX_STATES = 2000;
export const PATTERN_MAX_LENGTH = 200;

export const ERR = {
  syntax: 'Invalid pattern: check the syntax.',
  unmatchedParen: 'Invalid pattern: unmatched )',
  missingParen: 'Invalid pattern: missing closing )',
  missingBracket: 'Invalid pattern: missing closing ]',
  nothingToRepeat: 'Invalid pattern: nothing to repeat.',
  nested: 'This pattern could be very slow to check. Avoid nested repeats like (a+)+.',
  backref: 'Back-references like \\1 aren’t allowed.',
  lookaround: 'Lookahead and lookbehind like (?=…) aren’t allowed.',
  unsupported:
    'This pattern uses a feature that isn’t supported. Use letters, digits, [ ] classes, groups, | and repeats like * + ? {2,5}.',
  tooLong: 'Use 200 characters or fewer for the pattern.',
  tooComplex: 'This pattern is too complex to check quickly. Use smaller repeat counts.',
} as const;

type Range = [number, number];
export type Node =
  | { k: 'set'; neg: boolean; ranges: Range[] }
  | { k: 'start' }
  | { k: 'end' }
  | { k: 'seq'; items: Node[] }
  | { k: 'alt'; options: Node[] }
  | { k: 'group'; inner: Node }
  | { k: 'repeat'; inner: Node; min: number; max: number | null };

const DIGIT: Range[] = [[0x30, 0x39]];
const WORD: Range[] = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
];
const DOT: Range[] = [
  [0x0a, 0x0a],
  [0x0d, 0x0d],
  [0x2028, 0x2029],
];

class PatternError extends Error {}

export function size(n: Node): number {
  switch (n.k) {
    case 'set':
    case 'start':
    case 'end':
      return 1;
    case 'seq':
      return n.items.reduce((a, x) => a + size(x), 0);
    case 'alt':
      return n.options.reduce((a, x) => a + size(x), 0) + n.options.length;
    case 'group':
      return size(n.inner);
    case 'repeat':
      return size(n.inner) * (n.max ?? Math.max(n.min, 1)) + 1;
  }
}

function containsRepeat(n: Node): boolean {
  switch (n.k) {
    case 'repeat':
      return true;
    case 'seq':
      return n.items.some(containsRepeat);
    case 'alt':
      return n.options.some(containsRepeat);
    case 'group':
      return containsRepeat(n.inner);
    default:
      return false;
  }
}

const literal = (code: number): Node => ({ k: 'set', neg: false, ranges: [[code, code]] });
const isDigit = (c: string) => c >= '0' && c <= '9';
const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);

class Parser {
  pos = 0;
  constructor(private readonly p: string) {}
  private get atEnd() {
    return this.pos >= this.p.length;
  }
  private ch(): string {
    return this.p[this.pos];
  }

  parseAlternation(): Node {
    const options = [this.parseSequence()];
    while (!this.atEnd && this.ch() === '|') {
      this.pos++;
      options.push(this.parseSequence());
    }
    return options.length === 1 ? options[0] : { k: 'alt', options };
  }

  private parseSequence(): Node {
    const items: Node[] = [];
    while (!this.atEnd && this.ch() !== '|' && this.ch() !== ')') {
      const atom = this.parseAtom();
      items.push(this.parseQuantifier(atom));
    }
    return { k: 'seq', items };
  }

  private parseAtom(): Node {
    const c = this.ch();
    switch (c) {
      case '(':
        return this.parseGroup();
      case '[':
        return this.parseClass();
      case '.':
        this.pos++;
        return { k: 'set', neg: true, ranges: DOT };
      case '^':
        this.pos++;
        return { k: 'start' };
      case '$':
        this.pos++;
        return { k: 'end' };
      case '\\':
        return this.parseEscape(false);
      case '*':
      case '+':
      case '?':
        throw new PatternError(ERR.nothingToRepeat);
      case '{':
      case '}':
      case ']':
        throw new PatternError(ERR.syntax);
      default:
        this.pos++;
        return literal(c.charCodeAt(0));
    }
  }

  private parseGroup(): Node {
    this.pos++;
    if (!this.atEnd && this.ch() === '?') {
      const next = this.p[this.pos + 1] ?? '\0';
      if (next === ':') this.pos += 2;
      else if (next === '=' || next === '!') throw new PatternError(ERR.lookaround);
      else if (next === '<') {
        const after = this.p[this.pos + 2] ?? '\0';
        throw new PatternError(after === '=' || after === '!' ? ERR.lookaround : ERR.unsupported);
      } else throw new PatternError(ERR.unsupported);
    }
    const inner = this.parseAlternation();
    if (this.atEnd || this.ch() !== ')') throw new PatternError(ERR.missingParen);
    this.pos++;
    return { k: 'group', inner };
  }

  private parseQuantifier(atom: Node): Node {
    if (this.atEnd) return atom;
    let min: number;
    let max: number | null;
    switch (this.ch()) {
      case '*':
        min = 0;
        max = null;
        this.pos++;
        break;
      case '+':
        min = 1;
        max = null;
        this.pos++;
        break;
      case '?':
        min = 0;
        max = 1;
        this.pos++;
        break;
      case '{':
        [min, max] = this.parseBraces();
        break;
      default:
        return atom;
    }
    if (atom.k === 'start' || atom.k === 'end') throw new PatternError(ERR.nothingToRepeat);
    if (!this.atEnd && (this.ch() === '?' || this.ch() === '+')) throw new PatternError(ERR.unsupported);
    if (!this.atEnd && (this.ch() === '*' || this.ch() === '{')) throw new PatternError(ERR.nothingToRepeat);
    if (containsRepeat(atom)) throw new PatternError(ERR.nested);
    return { k: 'repeat', inner: atom, min, max };
  }

  private parseBraces(): [number, number | null] {
    this.pos++;
    const n = this.readInt();
    if (n === null) throw new PatternError(ERR.syntax);
    let m: number | null = n;
    if (!this.atEnd && this.ch() === ',') {
      this.pos++;
      if (this.atEnd || this.ch() === '}') m = null;
      else {
        m = this.readInt();
        if (m === null) throw new PatternError(ERR.syntax);
      }
    }
    if (this.atEnd || this.ch() !== '}') throw new PatternError(ERR.syntax);
    this.pos++;
    if (n > MAX_REPEAT || (m !== null && m > MAX_REPEAT)) throw new PatternError(ERR.tooComplex);
    if (m !== null && n > m) throw new PatternError(ERR.syntax);
    return [n, m];
  }

  private readInt(): number | null {
    const s = this.pos;
    while (!this.atEnd && isDigit(this.ch()) && this.pos - s < 4) this.pos++;
    if (this.pos === s) return null;
    if (!this.atEnd && isDigit(this.ch())) throw new PatternError(ERR.tooComplex);
    return parseInt(this.p.slice(s, this.pos), 10);
  }

  private parseClass(): Node {
    this.pos++;
    let neg = false;
    if (!this.atEnd && this.ch() === '^') {
      neg = true;
      this.pos++;
    }
    if (!this.atEnd && this.ch() === ']') throw new PatternError(ERR.syntax);
    const ranges: Range[] = [];
    for (;;) {
      if (this.atEnd) throw new PatternError(ERR.missingBracket);
      const c = this.ch();
      if (c === ']') {
        this.pos++;
        break;
      }
      if (c === '[') throw new PatternError(ERR.unsupported);
      let lo: number;
      if (c === '\\') {
        const set = this.parseEscape(true);
        const single = singleOf(set);
        if (single === null) {
          ranges.push(...(set as { ranges: Range[] }).ranges);
          continue;
        }
        lo = single;
      } else {
        this.pos++;
        lo = c.charCodeAt(0);
      }
      if (this.pos + 1 < this.p.length && this.ch() === '-' && this.p[this.pos + 1] !== ']') {
        this.pos++;
        let hi: number;
        if (this.ch() === '\\') {
          const s = singleOf(this.parseEscape(true));
          if (s === null) throw new PatternError(ERR.syntax);
          hi = s;
        } else if (this.ch() === '[') {
          throw new PatternError(ERR.unsupported);
        } else {
          hi = this.ch().charCodeAt(0);
          this.pos++;
        }
        if (lo > hi) throw new PatternError(ERR.syntax);
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    return { k: 'set', neg, ranges };
  }

  private parseEscape(inClass: boolean): Node {
    this.pos++;
    if (this.atEnd) throw new PatternError(ERR.syntax);
    const e = this.ch();
    this.pos++;
    switch (e) {
      case 'd':
        return { k: 'set', neg: false, ranges: DIGIT };
      case 'w':
        return { k: 'set', neg: false, ranges: WORD };
      case 's':
        return { k: 'set', neg: false, ranges: WHITESPACE_RANGES };
      case 'D':
      case 'W':
      case 'S':
        if (inClass) throw new PatternError(ERR.unsupported);
        return { k: 'set', neg: true, ranges: e === 'D' ? DIGIT : e === 'W' ? WORD : WHITESPACE_RANGES };
      case 't':
        return literal(0x09);
      case 'n':
        return literal(0x0a);
      case 'r':
        return literal(0x0d);
      case 'f':
        return literal(0x0c);
      case 'v':
        return literal(0x0b);
      case 'u':
        return literal(this.readHex(4));
      case 'x':
        return literal(this.readHex(2));
      case 'k':
        throw new PatternError(ERR.backref);
      default: {
        if (e >= '1' && e <= '9') throw new PatternError(ERR.backref);
        const code = e.charCodeAt(0);
        const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
        if (/[A-Za-z0-9]/.test(e) || control || isWhitespace(code)) throw new PatternError(ERR.unsupported);
        return literal(code);
      }
    }
  }

  private readHex(n: number): number {
    if (this.pos + n > this.p.length) throw new PatternError(ERR.syntax);
    const s = this.p.slice(this.pos, this.pos + n);
    for (const ch of s) if (!isHex(ch)) throw new PatternError(ERR.syntax);
    this.pos += n;
    return parseInt(s, 16);
  }
}

function singleOf(n: Node): number | null {
  return n.k === 'set' && !n.neg && n.ranges.length === 1 && n.ranges[0][0] === n.ranges[0][1] ? n.ranges[0][0] : null;
}

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: string };

export function parsePattern(pattern: string): ParseResult {
  if (pattern.length > PATTERN_MAX_LENGTH) return { ok: false, error: ERR.tooLong };
  try {
    const p = new Parser(pattern);
    const ast = p.parseAlternation();
    if (p.pos < pattern.length) throw new PatternError(ERR.unmatchedParen);
    if (size(ast) > MAX_STATES) throw new PatternError(ERR.tooComplex);
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof PatternError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Null when allowed, otherwise the user-facing error. */
export function checkPattern(pattern: string): string | null {
  const r = parsePattern(pattern);
  return r.ok ? null : r.error;
}

// ------------------------------------------------------------------ Thompson NFA

type State =
  | { t: 'set'; neg: boolean; ranges: Range[]; out: number }
  | { t: 'split'; a: number; b: number }
  | { t: 'start'; out: number }
  | { t: 'end'; out: number }
  | { t: 'eps'; out: number }
  | { t: 'match' };

interface Frag {
  start: number;
  /** states whose dangling `out`/`b` must be patched */
  outs: { s: number; f: 'out' | 'a' | 'b' }[];
}

class Compiler {
  states: State[] = [];
  add(s: State): number {
    this.states.push(s);
    return this.states.length - 1;
  }
  patch(outs: Frag['outs'], to: number) {
    for (const o of outs) (this.states[o.s] as unknown as Record<string, number>)[o.f] = to;
  }
  eps(): Frag {
    const s = this.add({ t: 'eps', out: -1 });
    return { start: s, outs: [{ s, f: 'out' }] };
  }
  compile(n: Node): Frag {
    switch (n.k) {
      case 'set': {
        const s = this.add({ t: 'set', neg: n.neg, ranges: n.ranges, out: -1 });
        return { start: s, outs: [{ s, f: 'out' }] };
      }
      case 'start':
      case 'end': {
        const s = this.add({ t: n.k, out: -1 });
        return { start: s, outs: [{ s, f: 'out' }] };
      }
      case 'group':
        return this.compile(n.inner);
      case 'seq': {
        if (!n.items.length) return this.eps();
        let frag = this.compile(n.items[0]);
        for (let i = 1; i < n.items.length; i++) {
          const next = this.compile(n.items[i]);
          this.patch(frag.outs, next.start);
          frag = { start: frag.start, outs: next.outs };
        }
        return frag;
      }
      case 'alt': {
        const frags = n.options.map((o) => this.compile(o));
        let frag = frags[frags.length - 1];
        for (let i = frags.length - 2; i >= 0; i--) {
          const s = this.add({ t: 'split', a: frags[i].start, b: frag.start });
          frag = { start: s, outs: [...frags[i].outs, ...frag.outs] };
        }
        return frag;
      }
      case 'repeat': {
        const parts: Frag[] = [];
        for (let i = 0; i < n.min; i++) parts.push(this.compile(n.inner));
        if (n.max === null) {
          const body = this.compile(n.inner);
          const s = this.add({ t: 'split', a: body.start, b: -1 });
          this.patch(body.outs, s);
          parts.push({ start: s, outs: [{ s, f: 'b' }] });
        } else {
          for (let i = n.min; i < n.max; i++) {
            const body = this.compile(n.inner);
            const s = this.add({ t: 'split', a: body.start, b: -1 });
            parts.push({ start: s, outs: [...body.outs, { s, f: 'b' }] });
          }
        }
        if (!parts.length) return this.eps();
        let frag = parts[0];
        for (let i = 1; i < parts.length; i++) {
          this.patch(frag.outs, parts[i].start);
          frag = { start: frag.start, outs: parts[i].outs };
        }
        return frag;
      }
    }
  }
}

const cache = new Map<string, { states: State[]; start: number }>();

function compiled(pattern: string) {
  let c = cache.get(pattern);
  if (!c) {
    const r = parsePattern(pattern);
    if (!r.ok) throw new Error(r.error);
    const comp = new Compiler();
    const frag = comp.compile(r.ast);
    const m = comp.add({ t: 'match' });
    comp.patch(frag.outs, m);
    c = { states: comp.states, start: frag.start };
    if (cache.size > 500) cache.clear();
    cache.set(pattern, c);
  }
  return c;
}

function inSet(code: number, s: { neg: boolean; ranges: Range[] }): boolean {
  let hit = false;
  for (const [lo, hi] of s.ranges)
    if (code >= lo && code <= hi) {
      hit = true;
      break;
    }
  return s.neg ? !hit : hit;
}

/** Search semantics (like RegExp.prototype.test) over UTF-16 code units, in O(len × states). */
export function patternMatches(pattern: string, value: string): boolean {
  const { states, start } = compiled(pattern);
  const n = value.length;
  const mark = new Int32Array(states.length).fill(-1);
  let current: number[] = [];
  let gen = 0;

  const addState = (list: number[], s: number, pos: number): boolean => {
    const stack = [s];
    while (stack.length) {
      const i = stack.pop()!;
      if (mark[i] === gen) continue;
      mark[i] = gen;
      const st = states[i];
      switch (st.t) {
        case 'match':
          return true;
        case 'split':
          stack.push(st.b, st.a);
          break;
        case 'eps':
          stack.push(st.out);
          break;
        case 'start':
          if (pos === 0) stack.push(st.out);
          break;
        case 'end':
          if (pos === n) stack.push(st.out);
          break;
        case 'set':
          list.push(i);
          break;
      }
    }
    return false;
  };

  for (let pos = 0; pos <= n; pos++) {
    gen++;
    const next: number[] = [];
    // carry over transitions from the previous position
    if (pos > 0) {
      const code = value.charCodeAt(pos - 1);
      for (const i of current) {
        const st = states[i] as Extract<State, { t: 'set' }>;
        if (inSet(code, st) && addState(next, st.out, pos)) return true;
      }
    }
    // unanchored search: a new attempt may start at every position
    if (addState(next, start, pos)) return true;
    current = next;
  }
  return false;
}
