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
    const fixable = forFile.filter((finding) => finding.fixable);
    if (fixable.length === 0) continue;

    const absolute = path.join(root, file);
    const outcome = await readTextFile(absolute);
    if (!outcome.ok) {
      onWarning?.(`cannot fix ${file}: ${outcome.reason}`);
      continue;
    }

    const updated = applyFixes(outcome.text, fixable);
    if (updated === outcome.text) continue;

    await writeFile(absolute, updated, 'utf8');
    files.push(file);
    fixed += fixable.length;
  }

  return { fixed, files };
}
