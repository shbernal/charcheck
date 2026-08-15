/**
 * The baseline as one run uses it: which file, whether it is read or written, and what that
 * leaves for the report to fail on.
 *
 * `src/baseline.ts` is the pure half and knows nothing about flags. This is where the flag
 * beats the config key, and where a run is stopped from recording as clean what it never
 * looked at.
 */

import path from 'node:path';

import {
  BASELINE_FILENAME,
  BaselineError,
  entriesFor,
  partition,
  readBaseline,
  serializeBaseline,
  writeBaseline,
} from '../baseline.js';
import type { Baseline, BaselineEntry, Partitioned } from '../baseline.js';
import type { LoadedConfig } from '../config/types.js';
import type { Finding } from '../types.js';
import type { ScanOutcome } from './modes.js';
import type { Options } from './options.js';

export interface BaselineUse {
  /** Absolute, since the config's directory is what a relative path in the config means. */
  filepath: string;
  write: boolean;
  strict: boolean;
  /** Drop the entries a fix run has just made unmatchable. See `prune`. */
  prune: boolean;
}

/**
 * What this run does about a baseline, or `undefined` for the runs that do nothing.
 *
 * A commit message is one of those whatever the config says: it is not a file in the tree,
 * so nothing about it can be recorded against one, and a repository that turned the baseline
 * on globally must not have its commit hook quietly change meaning. The flags are refused for
 * that mode in `parse`, so this only has the config key to overrule.
 */
export function baselineUse(loaded: LoadedConfig, options: Options): BaselineUse | undefined {
  if (options.commitMsg !== undefined) return undefined;

  const configured = loaded.config.baseline;
  // `--baseline-strict` says what to do about stale entries, which is an answer only a run
  // that reads the file can act on, so it turns the reading on rather than being ignored.
  const read =
    options.baseline ??
    (options.baselineStrict || (configured !== undefined && configured !== false));
  if (!read && !options.baselineWrite) return undefined;

  const name = typeof configured === 'string' ? configured : BASELINE_FILENAME;
  return {
    filepath: path.resolve(loaded.root, name),
    write: options.baselineWrite,
    strict: options.baselineStrict,
    prune: options.fix && !options.baselineWrite,
  };
}

export interface BaselineReport {
  /** What the run reports and fails on: every finding the baseline does not account for. */
  reported: Finding[];
  /** Findings the baseline accounted for, or that a write has just recorded. */
  accounted: number;
  /** Entries with no finding left. Empty after a write, which replaced the file. */
  stale: BaselineEntry[];
  written: boolean;
  /** There was no file to read. Every finding is new, which is worth saying out loud. */
  missing: boolean;
  /** Entries a fix run dropped, and whether the file was rewritten at all. */
  pruned?: { dropped: number };
  /** Why a fix run left the file alone, when it meant to prune it. */
  pruneRefused?: string;
}

/**
 * Rewrite the baseline from what survived a fix run.
 *
 * Only a fix run does this, and without a flag, because it is the run that removed the
 * findings: leaving the entries behind would nag about them on every run afterwards, and the
 * one command that would clear them is refused for the partial runs a hook makes.
 *
 * Entries are rebuilt from the findings the baseline matched rather than subtracted, so the
 * contexts of the findings that stayed are recorded as they now read. Fixing one of two
 * adjacent findings moves the other's window, and a rebuild is what stops that from living
 * on the count tier forever.
 *
 * Nothing outside what this run could see is touched: an entry for a file the run never
 * looked at is kept exactly as it was. `entriesFor` throwing is a refusal rather than a
 * failure, since the danger here is the opposite of a write's. A missing source would delete
 * entries for findings that are still there.
 */
async function prune(
  use: BaselineUse,
  outcome: ScanOutcome,
  baseline: Baseline,
  split: Partitioned,
): Promise<Pick<BaselineReport, 'pruned' | 'pruneRefused'>> {
  const rebuiltFiles = new Set(split.baselined.map((finding) => finding.file));
  // A positional path may name a directory, which is in scope without being any file's name.
  // A file that yielded a matched finding was certainly read, so it is covered either way.
  const covered = (file: string): boolean =>
    outcome.scope.kind === 'all' || outcome.scope.files.has(file) || rebuiltFiles.has(file);

  let rebuilt: BaselineEntry[];
  try {
    rebuilt = entriesFor(split.baselined, outcome.sources);
  } catch (cause) {
    if (cause instanceof BaselineError) return { pruneRefused: cause.message };
    throw cause;
  }

  const kept = baseline.entries.filter((entry) => !covered(entry.file));
  const next = [...kept, ...rebuilt];
  if (serializeBaseline(next) === serializeBaseline(baseline.entries)) return {};

  await writeBaseline(use.filepath, next);
  return { pruned: { dropped: baseline.entries.length - next.length } };
}

/**
 * Split the run's findings against the baseline, or record them as the baseline.
 *
 * Writing does not read first, and that is deliberate: `--baseline-write` records what is
 * there now, so partitioning against the file it is about to replace could only produce a
 * report of findings that are recorded by the time anyone reads it.
 *
 * Throws `BaselineError` for a file that exists and cannot be used, and for a write whose
 * findings have no source text. Both are the caller's to turn into a usage exit: a baseline
 * that cannot be trusted must not degrade into an empty one, which would report every
 * recorded finding as new.
 */
export async function applyBaseline(
  use: BaselineUse,
  outcome: ScanOutcome,
): Promise<BaselineReport> {
  if (use.write) {
    await writeBaseline(use.filepath, entriesFor(outcome.findings, outcome.sources));
    return {
      reported: [],
      accounted: outcome.findings.length,
      stale: [],
      written: true,
      missing: false,
    };
  }

  const baseline = await readBaseline(use.filepath);
  if (baseline === undefined) {
    return {
      reported: [...outcome.findings],
      accounted: 0,
      stale: [],
      written: false,
      missing: true,
    };
  }

  const split = partition(outcome.findings, outcome.sources, baseline, outcome.scope);
  const pruning =
    use.prune && outcome.fixedCount > 0 ? await prune(use, outcome, baseline, split) : {};

  return {
    reported: split.reported,
    accounted: split.baselined.length,
    // A pruned entry has been dropped, so nagging about it as well would be reporting the
    // same fix twice, in two voices that suggest different work.
    stale: pruning.pruned ? [] : split.stale,
    written: false,
    missing: false,
    ...pruning,
  };
}
