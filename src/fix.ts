import { BYTE_ORDER_MARK } from './chars.js';
import { stripBom } from './scan.js';
import type { Finding } from './types.js';

/** Why a fixable finding was not written. */
export type SkipReason =
  /** Another finding's replacement already covers this span. */
  | 'overlap'
  /**
   * The text at the finding's offset is no longer the text it matched, so the offset
   * denotes nothing and splicing at it would destroy unrelated content.
   */
  | 'stale';

export interface ApplyFixesOptions {
  /**
   * Called for a fixable finding that was not applied. Without it the skip is invisible,
   * and a caller counting the findings it passed in will overstate what was written.
   */
  onSkipped?: (finding: Finding, reason: SkipReason) => void;
}

/**
 * Rewrite the fixable findings into the text they came from.
 *
 * Applied right to left, so an earlier finding's offset is still valid after a later one
 * has changed the length of the text. Line endings are never normalized and a byte order
 * mark is preserved: a fixer that quietly rewrites every line of a CRLF file is worse than
 * no fixer at all.
 *
 * A finding is a position plus the text that was there, and this function is given text it
 * has no way to prove is the text those positions came from. So it checks, per finding,
 * rather than trusting the caller: `--fix --staged` computes findings from the git index
 * and then rewrites the working tree, and where the two have diverged an offset points at
 * whatever now happens to sit there. Splicing anyway destroyed content in files that
 * contained no banned character at all, so a finding whose match is no longer present is
 * skipped rather than written.
 */
export function applyFixes(
  text: string,
  findings: readonly Finding[],
  options: ApplyFixesOptions = {},
): string {
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
    if (end > previousOffset) {
      options.onSkipped?.(finding, 'overlap');
      continue;
    }
    // Everything written so far started at or after `previousOffset`, and `end` is at or
    // below it, so this span is still exactly as it was read. Comparing it against the text
    // the finding recorded is therefore a question about the caller's text, not about the
    // edits made above.
    if (result.slice(finding.offset, end) !== finding.match) {
      options.onSkipped?.(finding, 'stale');
      continue;
    }
    result = result.slice(0, finding.offset) + finding.replacement + result.slice(end);
    previousOffset = finding.offset;
  }

  return hadBom ? BYTE_ORDER_MARK + result : result;
}
