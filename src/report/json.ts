import type { Finding } from '../types.js';
import { listed, summarize } from './summary.js';
import type { ListOptions, Summary } from './summary.js';

/**
 * Bumped only for a breaking change to the shape below. Versioned from the first release
 * so a consumer parsing this output has something to branch on later.
 */
export const JSON_SCHEMA_VERSION = 1;

export interface JsonReport {
  schemaVersion: number;
  /** What the run reported. Under `--quiet` this holds the errors alone. */
  findings: Finding[];
  /** What the run found, and what the exit code was decided from. Never narrowed. */
  summary: Summary;
}

export function toJsonReport(findings: readonly Finding[], options: ListOptions = {}): JsonReport {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    findings: [...listed(findings, options)],
    summary: summarize(findings),
  };
}

export function formatJson(findings: readonly Finding[], options: ListOptions = {}): string {
  return JSON.stringify(toJsonReport(findings, options), null, 2);
}
