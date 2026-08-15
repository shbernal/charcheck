/**
 * The findings a repository already has, so a run can fail on the new ones alone.
 *
 * The whole point is adoption: a repository that is not at zero cannot turn this tool on in
 * CI at all, and `--max-warnings` only buys a number. Recording what is there today makes
 * the first green run possible and keeps the next banned character red.
 *
 * Nothing here knows about the CLI, and nothing here filters a scan. `scan()` still returns
 * every finding it sees; the partitioning happens above it, which is what keeps `ScanOptions`
 * and the rest of the frozen surface out of this.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { stripBom } from './scan.js';
import type { Finding } from './types.js';

/** Written beside the config file, since that is what the globs are relative to. */
export const BASELINE_FILENAME = 'charcheck-baseline.json';

/**
 * Bumped when the entry shape changes. An older charcheck meeting a newer file must say so
 * rather than read it as an empty baseline, which would turn every recorded finding into a
 * fresh failure.
 */
export const BASELINE_VERSION = 1;

/**
 * How much text either side of the match the context covers.
 *
 * Wide enough that two unrelated findings rarely share a window, narrow enough that an edit
 * elsewhere in the paragraph does not reach it.
 */
const WINDOW = 40;

/** Enough hex to make a collision uninteresting, short enough to read in a diff. */
const HASH_LENGTH = 12;

export interface BaselineEntry {
  file: string;
  ruleId: string;
  /** See `contextFor`. */
  context: string;
  /**
   * Which finding this is among those sharing `(file, ruleId, context)`, in offset order.
   * A file that holds the same window text twice needs it; nothing else does.
   */
  ordinal: number;
}

export interface Baseline {
  version: number;
  entries: BaselineEntry[];
}

/**
 * Which files this run actually looked at.
 *
 * Stale detection asks whether an entry's finding is gone, and that question is only
 * answerable for a file the run read. Under `--staged` or a positional path the run reads a
 * subset, and treating the rest as fixed would report the whole repository as stale on every
 * commit. `scan()` does not return the files it read, so the caller says instead: it holds
 * the same restriction it passed as `ScanOptions.files`.
 */
export type BaselineScope = { kind: 'all' } | { kind: 'files'; files: ReadonlySet<string> };

export interface Partitioned {
  /** Findings with no entry to account for them. These are what the run fails on. */
  reported: Finding[];
  /** Findings the baseline already knew about. */
  baselined: Finding[];
  /** Entries whose finding is gone, restricted to the files this run scanned. */
  stale: BaselineEntry[];
}

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineError';
  }
}

/**
 * The identity of a finding, as far as a baseline is concerned.
 *
 * A hash of the text around the match, with every whitespace run collapsed to one space.
 * The collapsing is the point: re-wrapping a paragraph is the most common edit in a
 * hard-wrapped prose repository, and it must not invalidate a single entry.
 *
 * `source` must be the text the offsets belong to, which is the text after `stripBom`.
 *
 * The enclosing sentence was the obvious alternative and is deliberately not used.
 * `src/sentence.ts` states its own boundary: it is a heuristic, read by a fix and never
 * used to place a finding. Keying a pass or fail on it would turn an abbreviation that ends
 * a sentence early into a CI failure on an unrelated pull request.
 */
export function contextFor(source: string, offset: number, length: number): string {
  const start = Math.max(0, offset - WINDOW);
  const end = Math.min(source.length, offset + length + WINDOW);
  const window = source.slice(start, end).replace(/\s+/gu, ' ').trim();
  return createHash('sha256').update(window).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Joins a composite map key. A character no path and no rule id can hold, since a space
 * would drop `("a b", "c")` and `("a", "b c")` into the same bucket.
 *
 * Written as an escape rather than typed: `looksBinary` sniffs for this character, so a
 * literal one in this file would make this repository's own scan skip the file whole.
 */
const SEPARATOR = '\u0000';

function bucketOf(file: string, ruleId: string): string {
  return `${file}${SEPARATOR}${ruleId}`;
}

function byPosition(a: Finding, b: Finding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.offset - b.offset;
}

function byEntry(a: BaselineEntry, b: BaselineEntry): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  if (a.context !== b.context) return a.context < b.context ? -1 : 1;
  return a.ordinal - b.ordinal;
}

/**
 * A finding paired with the identity it would be recorded under.
 *
 * `context` is absent when the file's text was not available, which happens only when the
 * read failed. Such a finding can still be matched by count, and `partition` does exactly
 * that rather than failing a run over a file nobody could read.
 */
interface Keyed {
  finding: Finding;
  context?: string;
  ordinal: number;
}

function keyFindings(findings: readonly Finding[], sources: ReadonlyMap<string, string>): Keyed[] {
  const stripped = new Map<string, string>();
  const counts = new Map<string, number>();

  return [...findings].sort(byPosition).map((finding) => {
    if (!stripped.has(finding.file)) {
      const source = sources.get(finding.file);
      if (source !== undefined) stripped.set(finding.file, stripBom(source).text);
    }
    const source = stripped.get(finding.file);
    if (source === undefined) return { finding, ordinal: 0 };

    const context = contextFor(source, finding.offset, finding.match.length);
    const key = `${bucketOf(finding.file, finding.ruleId)}${SEPARATOR}${context}`;
    const ordinal = counts.get(key) ?? 0;
    counts.set(key, ordinal + 1);
    return { finding, context, ordinal };
  });
}

/**
 * The entries that would record these findings, sorted for a readable diff.
 *
 * Throws when `sources` has no text for a finding's file, and that strictness is the point:
 * the only caller is a write, and a baseline written from a scan that could not read
 * everything records a false clean state for the files it missed. That is worse than having
 * no baseline, because the file now claims those files are known-good. Pruning after a fix
 * run goes through here too, where the same gap would delete entries whose findings are
 * still there.
 */
export function entriesFor(
  findings: readonly Finding[],
  sources: ReadonlyMap<string, string>,
): BaselineEntry[] {
  const entries = keyFindings(findings, sources).map(({ finding, context, ordinal }) => {
    if (context === undefined) {
      throw new BaselineError(
        `cannot record a finding in ${finding.file}: its content was not readable, so the ` +
          `baseline would record no findings for it at all.`,
      );
    }
    return { file: finding.file, ruleId: finding.ruleId, context, ordinal };
  });

  return entries.sort(byEntry);
}

/**
 * Split this run's findings into the ones the baseline accounts for and the ones it does not.
 *
 * Matching is two-tier, and the second tier is what keeps the file usable. Two findings
 * close together share a window, so fixing one changes the other's context, and a pull
 * request that only fixed things would fail. That is the failure mode that gets a baseline
 * deleted. So an exact `(file, ruleId, context, ordinal)` match is tried for every finding
 * first, and whatever is left is then paired by count within its `(file, ruleId)`.
 *
 * The result is never stricter than a plain count baseline, and no more precise than one
 * only where the text moved. A run fails when a `(file, ruleId)` genuinely holds more
 * findings than were recorded, and not otherwise.
 */
export function partition(
  findings: readonly Finding[],
  sources: ReadonlyMap<string, string>,
  baseline: Baseline,
  scope: BaselineScope = { kind: 'all' },
): Partitioned {
  const remaining = new Map<string, BaselineEntry[]>();
  for (const entry of baseline.entries) {
    const key = bucketOf(entry.file, entry.ruleId);
    const bucket = remaining.get(key);
    if (bucket) bucket.push(entry);
    else remaining.set(key, [entry]);
  }

  const baselined: Finding[] = [];
  const deferred: Keyed[] = [];

  // Tier one, and it has to run to completion before tier two starts: an entry a later
  // finding matches exactly must not have been spent on an earlier one by count.
  for (const keyed of keyFindings(findings, sources)) {
    const bucket = remaining.get(bucketOf(keyed.finding.file, keyed.finding.ruleId));
    const index =
      keyed.context === undefined || bucket === undefined
        ? -1
        : bucket.findIndex(
            (entry) => entry.context === keyed.context && entry.ordinal === keyed.ordinal,
          );

    if (index === -1 || bucket === undefined) deferred.push(keyed);
    else {
      bucket.splice(index, 1);
      baselined.push(keyed.finding);
    }
  }

  const reported: Finding[] = [];
  for (const { finding } of deferred) {
    const bucket = remaining.get(bucketOf(finding.file, finding.ruleId));
    if (bucket && bucket.length > 0) {
      bucket.shift();
      baselined.push(finding);
    } else reported.push(finding);
  }

  const stale = [...remaining.values()]
    .flat()
    .filter((entry) => (scope.kind === 'all' ? true : scope.files.has(entry.file)))
    .sort(byEntry);

  return {
    reported: reported.sort(byPosition),
    baselined: baselined.sort(byPosition),
    stale,
  };
}

function entryFrom(value: unknown, index: number, filepath: string): BaselineEntry {
  const problem = (detail: string): BaselineError =>
    new BaselineError(
      `the baseline at ${filepath} is malformed: entry ${String(index)} ${detail}.`,
    );

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw problem('is not an object');
  }
  const entry = value as Record<string, unknown>;
  for (const field of ['file', 'ruleId', 'context'] as const) {
    if (typeof entry[field] !== 'string' || entry[field].length === 0) {
      throw problem(`has no ${field}`);
    }
  }
  if (typeof entry.ordinal !== 'number' || !Number.isInteger(entry.ordinal) || entry.ordinal < 0) {
    throw problem('has no ordinal');
  }
  return {
    file: entry.file as string,
    ruleId: entry.ruleId as string,
    context: entry.context as string,
    ordinal: entry.ordinal,
  };
}

/**
 * The baseline at `filepath`, or `undefined` when there is no file there.
 *
 * Absence is a value because it is the normal state of a repository that has not written one
 * yet, and because `--baseline-write` has to work before the file exists. Every other
 * failure throws: a file that is present and unreadable, or present and malformed, must not
 * quietly become an empty baseline, which would report every recorded finding as new.
 */
export async function readBaseline(filepath: string): Promise<Baseline | undefined> {
  let text: string;
  try {
    text = await readFile(filepath, 'utf8');
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code === 'ENOENT') return undefined;
    throw new BaselineError(
      `cannot read the baseline at ${filepath}: ${code ?? (cause as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new BaselineError(
      `the baseline at ${filepath} is not valid JSON: ${(cause as Error).message}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BaselineError(`the baseline at ${filepath} is malformed: it is not an object.`);
  }
  const { version, entries } = parsed as { version?: unknown; entries?: unknown };

  if (version !== BASELINE_VERSION) {
    throw new BaselineError(
      `the baseline at ${filepath} is version ${JSON.stringify(version)}, and this charcheck ` +
        `reads version ${String(BASELINE_VERSION)}. Upgrade charcheck, or delete the file and ` +
        `write it again.`,
    );
  }
  if (!Array.isArray(entries)) {
    throw new BaselineError(`the baseline at ${filepath} is malformed: entries is not an array.`);
  }

  return {
    version,
    entries: entries.map((entry, index) => entryFrom(entry, index, filepath)),
  };
}

/**
 * The file's text: one entry per line, so a diff shows which findings were added or fixed
 * rather than one reflowed blob.
 */
export function serializeBaseline(entries: readonly BaselineEntry[]): string {
  const sorted = [...entries].sort(byEntry);
  const lines = sorted.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  const body = sorted.length === 0 ? '  "entries": []' : `  "entries": [\n${lines}\n  ]`;
  return `{\n  "version": ${String(BASELINE_VERSION)},\n${body}\n}\n`;
}

export async function writeBaseline(
  filepath: string,
  entries: readonly BaselineEntry[],
): Promise<void> {
  await writeFile(filepath, serializeBaseline(entries), 'utf8');
}
