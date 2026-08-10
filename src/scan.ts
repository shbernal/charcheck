import { BYTE_ORDER_MARK, describeChars } from './chars.js';
import { buildLineIndex, positionAt } from './position.js';
import type { LineIndex } from './position.js';
import { compileRule } from './rule.js';
import type { CompiledRule } from './rule.js';
import { buildSentenceIndex, sentenceAt } from './sentence.js';
import type { SentenceIndex } from './sentence.js';
import { getExtractor } from './scope/index.js';
import { isSuppressed, parseSuppressions } from './suppress.js';
import type { Suppressions } from './suppress.js';
import type { Chunk, ExtractorOptions, Finding, Rule } from './types.js';

export interface ScanTextOptions extends ExtractorOptions {
  /** Skip the binary sniff, for callers that already know the text is text. */
  assumeText?: boolean;
}

/** How much of the file to sniff before deciding it is binary. */
const SNIFF_LENGTH = 8192;

const NUL = String.fromCharCode(0);

/**
 * A careless glob (`docs/**`) will eventually hit a PNG. Decoded as UTF-8 it becomes a
 * string full of replacement characters, and a NUL in the first few KB is the cheap,
 * conventional tell.
 */
export function looksBinary(text: string): boolean {
  return text.slice(0, SNIFF_LENGTH).includes(NUL);
}

/**
 * A byte order mark is stripped before scanning, so it cannot shift every column on the
 * first line by one. Offsets in findings are therefore relative to the text *without* it,
 * and `applyFixes` strips and restores it the same way.
 */
export function stripBom(text: string): { text: string; hadBom: boolean } {
  return text.startsWith(BYTE_ORDER_MARK)
    ? { text: text.slice(1), hadBom: true }
    : { text, hadBom: false };
}

function messageFor(rule: CompiledRule, match: string): string {
  if (rule.message !== undefined) return rule.message;
  const trimmed = match.trim();
  const subject = trimmed.length > 0 ? trimmed : match;
  return `Banned character ${describeChars(subject)}`;
}

function resolveReplacement(
  rule: CompiledRule,
  match: string,
  container: string,
  index: number,
): string | undefined {
  if (rule.fix === undefined) return undefined;
  if (typeof rule.fix === 'string') return rule.fix;
  return rule.fix({ container, match, index, scope: rule.scope });
}

/**
 * Scan a single file's text. Pure: no filesystem, no globs, no process state. Async only
 * because a scope's extractor may have to import its parser first.
 *
 * Rules are applied as given; deciding which rules apply to which files belongs to the
 * caller, since that needs globs.
 */
export async function scanText(
  text: string,
  file: string,
  rules: readonly Rule[],
  options: ScanTextOptions = {},
): Promise<Finding[]> {
  if (rules.length === 0) return [];
  if (!options.assumeText && looksBinary(text)) return [];

  const { text: source } = stripBom(text);
  if (source.length === 0) return [];

  const extractorOptions: ExtractorOptions = { textAttributes: options.textAttributes };

  let lineIndex: LineIndex | undefined;
  const lines = (): LineIndex => (lineIndex ??= buildLineIndex(source));
  let sentenceIndex: SentenceIndex | undefined;
  const sentences = (): SentenceIndex => (sentenceIndex ??= buildSentenceIndex(source));
  let suppressions: Suppressions | undefined;
  const suppressed = (ruleId: string, line: number): boolean => {
    suppressions ??= parseSuppressions(source, file);
    return isSuppressed(suppressions, ruleId, line);
  };

  const findings: Finding[] = [];

  for (const rule of rules) {
    const compiled = compileRule(rule);

    // The fast path that keeps this usable on a big tree: most files contain no banned
    // character at all, and those must never reach a parser.
    compiled.regex.lastIndex = 0;
    if (!compiled.regex.test(source)) continue;

    const chunks = await getExtractor(compiled.scope)(source, file, extractorOptions);

    for (const chunk of chunks) {
      collectInChunk(chunk, compiled, source, file, findings, lines, sentences, suppressed);
    }
  }

  findings.sort((a, b) => a.offset - b.offset || (a.ruleId < b.ruleId ? -1 : 1));
  return findings;
}

function collectInChunk(
  chunk: Chunk,
  rule: CompiledRule,
  source: string,
  file: string,
  findings: Finding[],
  lines: () => LineIndex,
  sentences: () => SentenceIndex,
  suppressed: (ruleId: string, line: number) => boolean,
): void {
  const { regex } = rule;
  regex.lastIndex = chunk.start;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const start = match.index;
    const matched = match[0];

    if (matched.length === 0) {
      // A pattern that can match nothing would otherwise spin forever.
      regex.lastIndex += 1;
      continue;
    }
    if (start >= chunk.end) break;
    // A match that runs past the chunk is not inside it. A shorter one may still start
    // later and fit, so step forward rather than abandoning the chunk.
    if (start + matched.length > chunk.end) {
      regex.lastIndex = start + 1;
      continue;
    }

    const { line, column } = positionAt(lines(), start);
    if (suppressed(rule.id, line)) continue;

    const enclosing =
      chunk.container === 'self'
        ? { text: source.slice(chunk.start, chunk.end), start: chunk.start }
        : sentenceAt(sentences(), start);
    const replacement = resolveReplacement(rule, matched, enclosing.text, start - enclosing.start);

    findings.push({
      ruleId: rule.id,
      file,
      line,
      column,
      endColumn: positionAt(lines(), start + matched.length).column,
      offset: start,
      match: matched,
      message: messageFor(rule, matched),
      severity: rule.severity,
      fixable: replacement !== undefined,
      ...(replacement !== undefined ? { replacement } : {}),
    });
  }
}
