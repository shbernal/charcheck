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
    const fixable = forFile.filter(
      (finding) => finding.fixable && finding.replacement !== undefined,
    );
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
