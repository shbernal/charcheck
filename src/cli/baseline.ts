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
  entriesFor,
  partition,
  readBaseline,
  writeBaseline,
} from '../baseline.js';
import type { BaselineEntry, BaselineScope } from '../baseline.js';
import type { LoadedConfig } from '../config/types.js';
import type { Finding } from '../types.js';
import type { Options } from './options.js';

export interface BaselineUse {
  /** Absolute, since the config's directory is what a relative path in the config means. */
  filepath: string;
  write: boolean;
  strict: boolean;
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
  outcome: { findings: Finding[]; sources: Map<string, string>; scope: BaselineScope },
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
  return {
    reported: split.reported,
    accounted: split.baselined.length,
    stale: split.stale,
    written: false,
    missing: false,
  };
}
