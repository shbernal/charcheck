import { SCOPE_EXTENSIONS, SCOPES } from '../scope/index.js';
import type { Rule, Scope, Severity } from '../types.js';
import type { CharcheckConfig } from './types.js';

/**
 * Validation is hand-written. The dependency budget is the point of this tool, and a
 * schema library would be the largest thing it installs.
 *
 * Messages name the rule and the field, because a mistyped config is the most common
 * failure anyone will hit and "expected object" tells them nothing.
 */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[], source?: string) {
    const where = source ? ` in ${source}` : '';
    super(`Invalid charcheck config${where}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Patterns in angle brackets name a surface that is not a file, such as a commit message. */
export const VIRTUAL_PATTERN = /^<[a-z-]+>$/;

const SEVERITIES: Severity[] = ['error', 'warn'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, label: string, problems: string[]): string[] | undefined {
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array of strings.`);
    return undefined;
  }
  if (value.some((entry) => typeof entry !== 'string')) {
    problems.push(`${label} must contain only strings.`);
    return undefined;
  }
  return value as string[];
}

/**
 * The extensions a pattern can possibly match, or undefined when that cannot be known
 * (`docs/**`, `*`). Only a pattern with a literal trailing extension is decidable, and
 * only those are worth reporting on.
 */
export function patternExtensions(pattern: string): string[] | undefined {
  const braces = /\.\{([^{}/]+)\}$/.exec(pattern);
  if (braces) {
    const parts = braces[1]!.split(',').map((part) => part.trim());
    if (parts.every((part) => part.length > 0 && !/[*?]/.test(part))) {
      return parts.map((part) => `.${part.toLowerCase()}`);
    }
    return undefined;
  }
  const plain = /(\.[A-Za-z0-9]+)$/.exec(pattern);
  return plain ? [plain[1]!.toLowerCase()] : undefined;
}

/**
 * An include pattern that names an extension its scope cannot read is a config error, even
 * when the same pattern also names one the scope can.
 *
 * The extractors return no chunks for a file they do not recognize, and no chunks is
 * indistinguishable from a clean file: the scan reports nothing, warns about nothing, and
 * exits zero. So `scope: 'markdown'` with `**\/*.{ts,md}` quietly stops checking the
 * TypeScript, and the run that stopped checking it looks exactly like the run that passed.
 * That is this tool's characteristic silent failure, and catching it here costs nothing at
 * scan time.
 *
 * The fix is to split the rule and give each extension the scope that can read it, which is
 * why this reports per pattern: the pattern is the thing that has to change.
 *
 * A pattern with no literal trailing extension (`docs/**`) is undecidable and is passed
 * over. It may well match an unreadable file at scan time, but rejecting it here would
 * reject the most ordinary glob anyone writes.
 *
 * Driven off the scope table, so adding an extractor cannot forget this check.
 */
function checkScopeAgainstPatterns(rule: Rule, label: string, problems: string[]): void {
  const scope = rule.scope ?? 'raw';
  const supported = SCOPE_EXTENSIONS[scope];
  if (!supported || !Array.isArray(rule.include)) return;

  for (const pattern of rule.include) {
    if (typeof pattern !== 'string' || VIRTUAL_PATTERN.test(pattern)) continue;

    const extensions = patternExtensions(pattern);
    if (extensions === undefined) continue;

    const unreadable = extensions.filter((extension) => !supported.includes(extension));
    if (unreadable.length === 0) continue;

    problems.push(
      `${label} uses scope "${scope}", which reads only ${supported.join(', ')}, ` +
        `but its include pattern "${pattern}" targets ${unreadable.join(', ')}. ` +
        `Such a file is scanned as empty and reported as clean, so split the rule and give ` +
        `each extension a scope that can read it.`,
    );
  }
}

function validateRule(value: unknown, index: number, problems: string[]): void {
  const label = `rules[${index}]`;
  if (!isRecord(value)) {
    problems.push(`${label} must be an object.`);
    return;
  }

  const id = value['id'];
  const name = typeof id === 'string' && id.length > 0 ? `rule "${id}"` : label;
  if (typeof id !== 'string' || id.length === 0) {
    problems.push(`${label}.id must be a non-empty string.`);
  }

  const hasChars = value['chars'] !== undefined;
  const hasPattern = value['pattern'] !== undefined;
  if (hasChars && hasPattern) {
    problems.push(`${name} sets both "chars" and "pattern"; use one.`);
  } else if (!hasChars && !hasPattern) {
    problems.push(`${name} must set either "chars" or "pattern".`);
  }

  if (hasChars) {
    const chars = stringArray(value['chars'], `${name}.chars`, problems);
    if (chars && chars.length === 0) problems.push(`${name}.chars is empty.`);
    if (chars?.some((entry) => entry.length === 0)) {
      problems.push(`${name}.chars contains an empty string.`);
    }
  }
  if (hasPattern) {
    if (typeof value['pattern'] !== 'string') {
      problems.push(`${name}.pattern must be a string.`);
    } else {
      try {
        new RegExp(value['pattern'] as string, 'gu');
      } catch (cause) {
        problems.push(`${name}.pattern is not a valid regular expression: ${String(cause)}`);
      }
    }
  }

  if (value['include'] === undefined) {
    problems.push(`${name} must set "include". A rule with no target scans nothing.`);
  } else {
    const include = stringArray(value['include'], `${name}.include`, problems);
    if (include?.length === 0) problems.push(`${name}.include is empty.`);
  }
  if (value['exclude'] !== undefined) stringArray(value['exclude'], `${name}.exclude`, problems);

  const scope = value['scope'];
  if (scope !== undefined && !SCOPES.includes(scope as Scope)) {
    problems.push(`${name}.scope must be one of ${SCOPES.join(', ')}.`);
  }

  const severity = value['severity'];
  if (severity !== undefined && !SEVERITIES.includes(severity as Severity)) {
    problems.push(`${name}.severity must be "error" or "warn".`);
  }

  const fix = value['fix'];
  if (fix !== undefined && typeof fix !== 'string' && typeof fix !== 'function') {
    problems.push(`${name}.fix must be a replacement string or a function.`);
  }

  const message = value['message'];
  if (message !== undefined && typeof message !== 'string') {
    problems.push(`${name}.message must be a string.`);
  }

  // Only for a rule that named itself, so the message below can say which rule it is about.
  // `problems` accumulates across every rule, so it can say nothing about this one.
  if (typeof id === 'string') {
    checkScopeAgainstPatterns(value as unknown as Rule, name, problems);
  }
}

export function validateConfig(value: unknown, source?: string): CharcheckConfig {
  const problems: string[] = [];

  if (!isRecord(value)) {
    throw new ConfigError(['the config must export an object.'], source);
  }

  const rules = value['rules'];
  if (!Array.isArray(rules)) {
    problems.push('"rules" must be an array.');
  } else if (rules.length === 0) {
    problems.push('"rules" is empty, so nothing would be checked.');
  } else {
    rules.forEach((rule, index) => validateRule(rule, index, problems));

    const seen = new Set<string>();
    for (const rule of rules) {
      const id = isRecord(rule) ? rule['id'] : undefined;
      if (typeof id !== 'string') continue;
      if (seen.has(id)) problems.push(`duplicate rule id "${id}".`);
      seen.add(id);
    }
  }

  if (value['ignore'] !== undefined) stringArray(value['ignore'], '"ignore"', problems);

  if (value['textAttributes'] !== undefined) {
    stringArray(value['textAttributes'], '"textAttributes"', problems);
  }

  const baseline = value['baseline'];
  if (baseline !== undefined && typeof baseline !== 'string' && typeof baseline !== 'boolean') {
    problems.push('"baseline" must be a path, or true for the default file name.');
  } else if (typeof baseline === 'string' && baseline.trim().length === 0) {
    // An empty path would resolve to the config's own directory, and a directory is not a
    // baseline. Someone reaching for "no baseline" wants false, or the key gone.
    problems.push('"baseline" is an empty path. Use true for the default file name, or false.');
  }

  const markup = value['markup'];
  if (markup !== undefined) {
    if (!isRecord(markup)) problems.push('"markup" must be an object.');
    else if (markup['textAttributes'] !== undefined) {
      stringArray(markup['textAttributes'], '"markup.textAttributes"', problems);
      // Both spellings feed one allowlist, so a config setting both has written two answers
      // to one question. Picking a winner here would silently discard the other.
      if (value['textAttributes'] !== undefined) {
        problems.push(
          '"textAttributes" and "markup.textAttributes" are both set, and they are the same ' +
            'setting. Keep the top-level one: it covers the "html" scope as well.',
        );
      }
    }
  }

  if (problems.length > 0) throw new ConfigError(problems, source);
  return value as unknown as CharcheckConfig;
}
