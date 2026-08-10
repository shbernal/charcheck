import type { FixFunction, Rule, Scope, Severity } from './types.js';

export interface CompiledRule {
  id: string;
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

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIALS, '\\$&');
}

/**
 * Longest first, so a multi-character sequence wins over a prefix of itself. Ties fall
 * back to code-unit order purely so the compiled source is stable across runs.
 */
function byLengthThenValue(a: string, b: string): number {
  return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
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
