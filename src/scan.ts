import { BYTE_ORDER_MARK, describeChars } from './chars.js';
import { compareStrings } from './order.js';
import { buildLineIndex, positionAt } from './position.js';
import type { LineIndex } from './position.js';
import { compileRule } from './rule.js';
import type { CompiledRule } from './rule.js';
import { firstAbove } from './search.js';
import { buildSentenceIndex, sentenceAt } from './sentence.js';
import type { SentenceIndex } from './sentence.js';
import { getExtractor } from './scope/index.js';
import { isSuppressed, parseSuppressions } from './suppress.js';
import type { Suppressions } from './suppress.js';
import type { Chunk, ExtractorOptions, Finding, Rule, Scope } from './types.js';

export interface ScanTextOptions extends ExtractorOptions {
  /** Skip the binary sniff, for callers that already know the text is text. */
  assumeText?: boolean;
  /**
   * Called for a finding a marker silenced, instead of it being returned.
   *
   * A suppressed finding is never in the returned array, so a caller that fixes or fails on
   * findings is unaffected by asking for this. What it buys is the ability to say how many
   * checks a run gave up, which is otherwise the one thing a silenced run looks exactly like
   * a clean one about.
   *
   * The finding is built in full, replacement included, only when this is given.
   */
  onSuppressed?: (finding: Finding) => void;
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

  /**
   * One parse per scope for this file, not one per rule that reaches it.
   *
   * The chunk list depends on the text, the file name and the extractor options, none of
   * which vary inside one call, and nothing downstream mutates a chunk. Without this, four
   * Markdown rules that all match meant four passes over the same document, so a run grew
   * linearly in the rule count where it should have been flat, and it grew exactly when a
   * config was doing its job.
   *
   * The pending promise is cached rather than the resolved array, so two rules of one scope
   * arriving before the first parse settles still share it. A rejection is shared with them
   * too, which is what a file the scope refuses wants: skipped once, not once per rule.
   *
   * Per call, deliberately. A cache spanning files would be keyed by text and would hold
   * whole parse results for a tree the scan has already walked past.
   */
  const extracted = new Map<Scope, Promise<readonly Chunk[]>>();
  const chunksFor = (scope: Scope): Promise<readonly Chunk[]> => {
    let pending = extracted.get(scope);
    if (pending === undefined) {
      pending = getExtractor(scope)(source, file, extractorOptions);
      extracted.set(scope, pending);
    }
    return pending;
  };

  const findings: Finding[] = [];
  const context: ScanContext = {
    source,
    file,
    findings,
    lines,
    sentences,
    suppressed,
    ...(options.onSuppressed ? { onSuppressed: options.onSuppressed } : {}),
  };

  for (const rule of rules) {
    const compiled = compileRule(rule);

    // The fast path that keeps this usable on a big tree: most files contain no banned
    // character at all, and those must never reach a parser.
    const matches = findMatches(compiled.regex, source);
    if (matches.starts.length === 0) continue;

    // Asked only after the gate above. A scope must never be parsed for a file no rule
    // matches in, which is the property that keeps this usable on a big tree.
    const chunks = await chunksFor(compiled.scope);

    for (const chunk of chunks) {
      if (!mayMatch(matches, chunk)) continue;
      collectInChunk(chunk, compiled, context);
    }
  }

  findings.sort((a, b) => a.offset - b.offset || compareStrings(a.ruleId, b.ruleId));
  return findings;
}

/**
 * Every span the rule matches, from one left-to-right pass over the whole file.
 *
 * This grew out of a cheaper question, whether the file contains a match at all, and the
 * extra work pays for itself many times over. `collectInChunk` restarts the engine at each
 * chunk, and an engine restarted with no match ahead of it scans to the end of the file
 * before the loop can stop, so the old shape cost chunks times file length. A prose document
 * is thousands of chunks, since every inline code span and link splits a paragraph into
 * separate spans, and on a 150 kB Markdown file holding a single banned character that spent
 * more time restarting the engine than the parser spent parsing.
 *
 * Zero-length matches are left out. `collectInChunk` steps over them rather than reporting
 * them, so a pattern that can only ever match nothing finds nothing, and answering that here
 * means never parsing the file for it.
 */
interface Matches {
  /** Ascending. Matches never overlap, so `ends` ascends with them. */
  starts: number[];
  ends: number[];
}

function findMatches(regex: RegExp, source: string): Matches {
  const starts: number[] = [];
  const ends: number[] = [];

  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (match[0].length === 0) {
      // A pattern that can match nothing would otherwise spin forever.
      regex.lastIndex += 1;
      continue;
    }
    starts.push(match.index);
    ends.push(match.index + match[0].length);
  }

  return { starts, ends };
}

/**
 * Is it worth running the collector over this chunk?
 *
 * The spans above are the greedy matches, and `collectInChunk` may report a shorter one in
 * the same place where a greedy match runs past the chunk's end. So the question asked here
 * is the conservative one, whether any greedy match overlaps the chunk at all: a
 * chunk holding a match the collector could reach always overlaps one, because the greedy
 * pass cannot walk past a position without matching at or before it. What is actually
 * reported stays the collector's decision.
 */
function mayMatch(matches: Matches, chunk: Chunk): boolean {
  const { starts, ends } = matches;
  // The first span ending after the chunk opens. `ends` ascends, so this is a binary search.
  const first = firstAbove(ends, chunk.start);
  return first < starts.length && starts[first]! < chunk.end;
}

/**
 * What every chunk of one file is collected against: the text, the lazy indices over it, and
 * where a finding goes once built. Bundled rather than passed one by one, because the
 * collector needs all of it and none of it varies per chunk.
 */
interface ScanContext {
  source: string;
  file: string;
  findings: Finding[];
  lines: () => LineIndex;
  sentences: () => SentenceIndex;
  suppressed: (ruleId: string, line: number) => boolean;
  onSuppressed?: (finding: Finding) => void;
}

function collectInChunk(chunk: Chunk, rule: CompiledRule, context: ScanContext): void {
  const { source, file, findings, lines, sentences, suppressed, onSuppressed } = context;
  const { regex } = rule;
  regex.lastIndex = chunk.start;

  /**
   * The text the engine reads, which stops where the chunk does as soon as anything has
   * tried to match past it.
   *
   * A greedy match may run past a chunk's end while a shorter one at the same place fits
   * inside it, and that shorter one is the finding. `\s*[<dash>]\s*` at the end of a
   * hard-wrapped line is the case that matters: the trailing `\s*` takes the line ending,
   * which the Markdown extractor left outside the chunk when the next line opens with an
   * inline code span, so the whole finding was dropped. Stepping forward a character does
   * not recover it, because a pattern that ends in the banned character has nothing left to
   * match once past it. The engine has to be made to backtrack, and truncating what it can
   * see is the only way to ask it to.
   *
   * The truncation is deferred until an overrun happens, so the common case still reads the
   * file's own string. Slicing a prefix is a view rather than a copy, so the cost is the one
   * pass the engine was going to make anyway.
   */
  let haystack = source;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(haystack)) !== null) {
    const start = match.index;
    const matched = match[0];

    if (matched.length === 0) {
      // A pattern that can match nothing would otherwise spin forever.
      regex.lastIndex += 1;
      continue;
    }
    if (start >= chunk.end) break;
    if (start + matched.length > chunk.end) {
      haystack = source.slice(0, chunk.end);
      regex.lastIndex = start;
      continue;
    }

    const { line, column } = positionAt(lines(), start);
    // Nobody asked what was silenced, so a silenced match costs nothing more than the
    // position that decided it. Resolving a fix is the expensive half, and a fix is a
    // function the config supplies.
    const silenced = suppressed(rule.id, line);
    if (silenced && onSuppressed === undefined) continue;

    const enclosing =
      chunk.container === 'self'
        ? { text: source.slice(chunk.start, chunk.end), start: chunk.start }
        : sentenceAt(sentences(), start);
    const replacement = resolveReplacement(rule, matched, enclosing.text, start - enclosing.start);

    const finding: Finding = {
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
    };

    // A suppressed finding is handed over rather than returned. It must not reach the
    // returned array: `--fix` would rewrite the text a marker exists to leave alone, and the
    // exit code would fail on a finding the author silenced on purpose.
    if (silenced) onSuppressed?.(finding);
    else findings.push(finding);
  }
}
