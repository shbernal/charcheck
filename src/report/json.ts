import type { Finding } from '../types.js';
import { summarize } from './summary.js';
import type { Summary } from './summary.js';

/**
 * Bumped only for a breaking change to the shape below. Versioned from the first release
 * so a consumer parsing this output has something to branch on later.
 */
export const JSON_SCHEMA_VERSION = 1;

export interface JsonReport {
  schemaVersion: number;
  findings: Finding[];
  summary: Summary;
}

export function toJsonReport(findings: readonly Finding[]): JsonReport {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    findings: [...findings],
    summary: summarize(findings),
  };
}

export function formatJson(findings: readonly Finding[]): string {
  return JSON.stringify(toJsonReport(findings), null, 2);
}
