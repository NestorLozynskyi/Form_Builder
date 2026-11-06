import vectors from '../../../../../shared/validation-vectors.json';
import { Block } from '../schema/form-schema';
import { blockIssues, validateAnswer } from './rules';
import { checkPattern, patternMatches } from './safe-pattern';

/**
 * The same file is executed by backend/tests/FormBuilder.Api.Tests/SharedVectorsTests.cs, which guarantees that the
 * Angular client and the .NET server validate identical data identically.
 */
interface AnswerVector { name: string; block: Block; value: unknown; today: string; error: string | null; normalized: unknown }
interface ConfigVector { name: string; block: Block; expected: { key: string; message: string }[] }
interface PatternVector { pattern: string; error: string | null; matches: [string, boolean][] }

const data = vectors as unknown as { answers: AnswerVector[]; config: ConfigVector[]; patterns: PatternVector[] };

describe('shared validation vectors', () => {
  it.each(data.answers.map((v) => [v.name, v] as const))('answer: %s', (_name, v) => {
    const r = validateAnswer(v.block, v.value, v.today);
    expect(r.error).toBe(v.error);
    expect(r.value).toEqual(v.normalized);
  });

  it.each(data.config.map((v) => [v.name, v] as const))('config: %s', (_name, v) => {
    expect(blockIssues(v.block).map(({ key, message }) => ({ key, message }))).toEqual(v.expected);
  });

  it.each(data.patterns.map((v) => [v.pattern.slice(0, 60), v] as const))('pattern: %s', (_name, v) => {
    expect(checkPattern(v.pattern)).toBe(v.error);
    for (const [value, expected] of v.matches) {
      const started = performance.now();
      expect(patternMatches(v.pattern, value)).toBe(expected);
      expect(performance.now() - started).toBeLessThan(250);
    }
  });
});
