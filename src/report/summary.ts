import type { Finding } from '../types.js';

export interface Summary {
  errors: number;
  warnings: number;
  fixable: number;
  files: number;
}

export function summarize(findings: readonly Finding[]): Summary {
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
  return { errors, warnings, fixable, files: files.size };
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
