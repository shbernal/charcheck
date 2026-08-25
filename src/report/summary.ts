import type { Finding } from '../types.js';

export interface Summary {
  errors: number;
  warnings: number;
  fixable: number;
  files: number;
  /**
   * How many findings a suppression marker silenced. They are not in `findings`, do not
   * count towards anything above, and do not fail the run. The number is the whole point:
   * without it a run that was told to say nothing is byte for byte a run that found nothing.
   */
  suppressed: number;
}

export interface ListOptions {
  /**
   * List errors only. The summary still counts the warnings: a report that hid them and an
   * exit code that failed on them disagreed, and the failure was unexplainable.
   */
  quiet?: boolean;
}

/** The findings a report enumerates, which under `--quiet` is fewer than it counts. */
export function listed(findings: readonly Finding[], options: ListOptions): readonly Finding[] {
  return options.quiet === true
    ? findings.filter((finding) => finding.severity === 'error')
    : findings;
}

export function summarize(
  findings: readonly Finding[],
  suppressed: readonly Finding[] = [],
): Summary {
  const files = new Set<string>();
  let errors = 0;
  let warnings = 0;
  let fixable = 0;
  for (const finding of findings) {
    files.add(finding.file);
    if (finding.severity === 'error') errors += 1;
    else warnings += 1;
    if (finding.fixable) fixable += 1;
  }
  return { errors, warnings, fixable, files: files.size, suppressed: suppressed.length };
}

/** Findings grouped by file, in the order the files first appear. */
export function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = grouped.get(finding.file);
    if (existing) existing.push(finding);
    else grouped.set(finding.file, [finding]);
  }
  return grouped;
}
