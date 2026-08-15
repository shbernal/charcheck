import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyFixes } from './fix.js';
import { readTextFile } from './read.js';
import { groupByFile } from './report/summary.js';
import type { Finding } from './types.js';

export interface FixOutcome {
  /** Findings actually rewritten. */
  fixed: number;
  files: string[];
}

/**
 * What `applyFixes` will actually write.
 *
 * `fixable` is a claim about the rule and the replacement is the thing itself. They agree
 * for every finding `scan` produces, and a caller assembling findings by hand is the reason
 * both are checked.
 */
export function isFixable(finding: Finding): boolean {
  return finding.fixable && finding.replacement !== undefined;
}

/**
 * Write the fixable findings back to disk.
 *
 * Line endings and a byte order mark survive, because `applyFixes` rewrites only the
 * matched spans of the original text and never re-serializes the file.
 */
export async function fixFiles(
  root: string,
  findings: readonly Finding[],
  onWarning?: (message: string) => void,
): Promise<FixOutcome> {
  const files: string[] = [];
  let fixed = 0;

  for (const [file, forFile] of groupByFile(findings)) {
    // The same filter `applyFixes` applies, so the count below can be exact rather than an
    // estimate made from a wider set.
    const fixable = forFile.filter(isFixable);
    if (fixable.length === 0) continue;

    const absolute = path.join(root, file);
    const outcome = await readTextFile(absolute);
    if (!outcome.ok) {
      onWarning?.(`cannot fix ${file}: ${outcome.reason}`);
      continue;
    }

    let skipped = 0;
    let stale = 0;
    const updated = applyFixes(outcome.text, fixable, {
      onSkipped: (_finding, reason) => {
        skipped += 1;
        if (reason === 'stale') stale += 1;
      },
    });

    // Worth a warning rather than a silent difference in the count: it means this file on
    // disk is not the text the findings were read from, which under `--staged` is an
    // unstaged edit and under a plain run is something having changed mid-flight.
    if (stale > 0) {
      onWarning?.(
        `cannot fix ${String(stale)} finding(s) in ${file}: the text there has changed since ` +
          `it was scanned, so the fix would land on content it was not computed against. ` +
          `Re-run once the file and what was scanned agree.`,
      );
    }

    if (updated === outcome.text) continue;

    await writeFile(absolute, updated, 'utf8');
    files.push(file);
    fixed += fixable.length - skipped;
  }

  return { fixed, files };
}

/**
 * How many times a run rewrites and re-scans before it gives up.
 *
 * Ten is ESLint's number and is chosen the same way: high enough that no honest chain of
 * rules reaches it, low enough that a pair of rules arguing costs a moment rather than a
 * hung hook.
 */
export const MAX_FIX_PASSES = 10;

export interface FixpointOutcome {
  /** The findings as the last pass left them, ready to report. */
  findings: Finding[];
  /** Findings actually rewritten, totalled over every pass. */
  fixed: number;
  /** Every file written, each named once, in the order it was first written. */
  files: string[];
  /** False when the passes ran out with fixable findings still standing. */
  converged: boolean;
}

export interface FixpointOptions {
  /**
   * Files this run must not write, whatever their findings say, named as the findings spell
   * them. Their findings are still returned and still reported: held back from the fix is
   * not excused from the check.
   *
   * `--staged` passes the files that differ from the index. Writing one means `git add` on a
   * file the developer left half-staged, which commits the half they held back.
   */
  hold?: ReadonlySet<string>;
  /**
   * Runs between the write and the re-scan, for a caller whose next scan reads something
   * other than the files just written: `--staged` scans the index, so the fixes have to be
   * staged before the next pass looks, or that pass reads them as never having happened.
   */
  afterPass?: (files: readonly string[]) => Promise<void>;
}

/**
 * Rewrite, re-scan, and rewrite again until the tree stops changing.
 *
 * One pass is not enough, and the reason is that a replacement is arbitrary text which may
 * itself contain what another rule bans. A house style rewriting an em dash to an en dash,
 * next to a rule that bans the en dash, needs two passes to reach the answer both rules
 * agree on. `applyFixes` also skips a fix whose span another rule's replacement already
 * covered, and the re-scan is what gives that one its next chance, judged against the text
 * as it now reads rather than the text it was computed against.
 *
 * Two rules can equally well disagree forever, each rewriting what the other just wrote.
 * Nothing here can settle that, so the loop stops at `MAX_FIX_PASSES` and says so. The
 * alternative, stopping quietly, leaves the tree mid-argument while the report calls it
 * fixed.
 */
export async function fixToFixpoint(
  root: string,
  findings: readonly Finding[],
  rescan: () => Promise<Finding[]>,
  onWarning: (message: string) => void,
  options: FixpointOptions = {},
): Promise<FixpointOutcome> {
  const { hold, afterPass } = options;
  const written = new Set<string>();
  let current = [...findings];
  let fixed = 0;

  // What this run is willing to write, as opposed to what it found. A held file's fixable
  // finding must not keep the loop alive either: nothing intends to write it, so it would
  // spin to the cap and report an oscillation that is not happening.
  const writable = (all: readonly Finding[]): Finding[] =>
    hold === undefined || hold.size === 0 ? [...all] : all.filter((f) => !hold.has(f.file));

  for (let pass = 1; ; pass += 1) {
    const outcome = await fixFiles(root, writable(current), onWarning);
    fixed += outcome.fixed;
    // Nothing was written, so a re-scan could only return the findings already in hand.
    // This is the ordinary exit: the first pass fixes what it can and the second finds
    // nothing left to write.
    if (outcome.files.length === 0) break;

    for (const file of outcome.files) written.add(file);
    await afterPass?.(outcome.files);
    current = await rescan();
    if (!writable(current).some(isFixable)) break;

    if (pass === MAX_FIX_PASSES) {
      onWarning(
        `stopped after ${String(MAX_FIX_PASSES)} fix passes with the text still changing, ` +
          `so two rules are rewriting each other's replacement. The files hold whatever the ` +
          `last pass wrote, which is one side of that argument rather than a settled result. ` +
          `This run is not a pass.`,
      );
      return { findings: current, fixed, files: [...written], converged: false };
    }
  }

  return { findings: current, fixed, files: [...written], converged: true };
}
