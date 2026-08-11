/**
 * Binary search over an ascending array of offsets.
 *
 * Three places need one: the line index, the sentence index, and the check for whether any
 * match overlaps a chunk. Written out at each of them, the two forms differ only in which
 * way the midpoint rounds and whether the answer may run off the end, which is exactly the
 * pair of details that is wrong in a hand-copied version and produces an off-by-one nobody
 * sees until a finding lands on the wrong line.
 */

/**
 * The last index whose value is at or below `target`, or 0 when every value is above it.
 *
 * The zero is deliberate rather than a sentinel: both callers index arrays that open at
 * offset 0, so no offset can precede the first entry and the answer for one that did would
 * still be the first entry.
 */
export function floorIndex(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    // Rounds up, so `low` can advance and the loop cannot spin on `high === low + 1`.
    const mid = (low + high + 1) >> 1;
    if (values[mid]! <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The first index whose value is strictly above `target`, or `values.length` when none is. */
export function firstAbove(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid]! > target) high = mid;
    else low = mid + 1;
  }
  return low;
}
