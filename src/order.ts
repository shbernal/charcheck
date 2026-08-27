/**
 * The orders findings and baseline entries are put in, written once.
 *
 * A report, a baseline file and a rescan all have to agree on where a finding sits, and the
 * comparators were written out four times to say so: `scan`'s own sort, a copy in the CLI
 * whose comment said it existed to match `scan`, and two more in the baseline. Three
 * spellings of one order is three places for a tie-break to drift, and a baseline written
 * under one order and read under another matches nothing while looking correct.
 */

import type { Finding } from './types.js';

/**
 * Lexicographic by code unit, for a `sort` comparator.
 *
 * Deliberately not `localeCompare`: a baseline file is committed and compared across
 * machines, and an order that depends on the locale a run happened to have would reorder
 * that file for the next person to write it.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The order every report and every baseline puts findings in: by file, then by offset. */
export function byPosition(a: Finding, b: Finding): number {
  return compareStrings(a.file, b.file) || a.offset - b.offset;
}
