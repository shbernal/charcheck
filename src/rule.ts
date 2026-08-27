import { compareStrings } from './order.js';
import { escapeRegExp } from './regex.js';
import type { FixFunction, Rule, Scope, Severity } from './types.js';

export interface CompiledRule {
  id: string;
  /**
   * Shared by every concurrent scan of every file, because the compilation below is
   * memoized on the `Rule` object. `lastIndex` is mutable state on that shared instance, so
   * four things have to stay true together for it to be safe, and none of them is local to
   * the place that would break:
   *
   * - `findMatches` runs to completion, which leaves `lastIndex` back at 0.
   * - The chunk loop in `collectInChunk` is synchronous end to end, so no other file's scan
   *   can interleave between two of its `exec` calls.
   * - The one `await` in the scan's rule loop is the extractor call, and neither side of it
   *   depends on `lastIndex` surviving.
   * - Every reader sets `lastIndex` itself before its first `exec`.
   *
   * Cloning per scan would settle it, and would also undo the reason this cache exists.
   */
  regex: RegExp;
  message: string | undefined;
  fix: string | FixFunction | undefined;
  severity: Severity;
  scope: Scope;
  include: string[];
  exclude: string[];
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/**
 * Longest first, so a multi-character sequence wins over a prefix of itself. Ties fall
 * back to code-unit order purely so the compiled source is stable across runs.
 */
function byLengthThenValue(a: string, b: string): number {
  return b.length - a.length || compareStrings(a, b);
}

const compiled = new WeakMap<Rule, CompiledRule>();

export function compileRule(rule: Rule): CompiledRule {
  const cached = compiled.get(rule);
  if (cached) return cached;

  if (rule.chars && rule.pattern) {
    throw new RuleError(`Rule "${rule.id}" sets both "chars" and "pattern"; use one.`);
  }
  if (!rule.chars && !rule.pattern) {
    throw new RuleError(`Rule "${rule.id}" sets neither "chars" nor "pattern".`);
  }
  if (rule.chars && rule.chars.length === 0) {
    throw new RuleError(`Rule "${rule.id}" has an empty "chars" list.`);
  }
  if (rule.chars?.some((entry) => entry.length === 0)) {
    throw new RuleError(`Rule "${rule.id}" has an empty string in "chars".`);
  }

  const source = rule.chars
    ? [...rule.chars].sort(byLengthThenValue).map(escapeRegExp).join('|')
    : (rule.pattern as string);

  let regex: RegExp;
  try {
    regex = new RegExp(source, 'gu');
  } catch (cause) {
    throw new RuleError(`Rule "${rule.id}" has an invalid pattern: ${(cause as Error).message}`);
  }

  const result: CompiledRule = {
    id: rule.id,
    regex,
    message: rule.message,
    fix: rule.fix,
    severity: rule.severity ?? 'error',
    scope: rule.scope ?? 'raw',
    include: rule.include,
    exclude: rule.exclude ?? [],
  };
  compiled.set(rule, result);
  return result;
}
