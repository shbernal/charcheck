import { BYTE_ORDER_MARK } from './chars.js';
import { stripBom } from './scan.js';
import type { Finding } from './types.js';

/**
 * Rewrite the fixable findings into the text they came from.
 *
 * Applied right to left, so an earlier finding's offset is still valid after a later one
 * has changed the length of the text. Line endings are never normalized and a byte order
 * mark is preserved: a fixer that quietly rewrites every line of a CRLF file is worse than
 * no fixer at all.
 */
export function applyFixes(text: string, findings: readonly Finding[]): string {
  const { text: source, hadBom } = stripBom(text);

  const fixable = findings
    .filter((finding) => finding.fixable && finding.replacement !== undefined)
    .sort((a, b) => b.offset - a.offset);

  if (fixable.length === 0) return text;

  let result = source;
  let previousOffset = Number.POSITIVE_INFINITY;

  for (const finding of fixable) {
    const end = finding.offset + finding.match.length;
    // Two rules can match overlapping spans. The later fix already rewrote this region, so
    // applying this one would corrupt it.
    if (end > previousOffset) continue;
    result = result.slice(0, finding.offset) + finding.replacement + result.slice(end);
    previousOffset = finding.offset;
  }

  return hadBom ? BYTE_ORDER_MARK + result : result;
}
