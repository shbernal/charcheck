/**
 * Counting in words, so a number reads the same wherever a person meets it.
 *
 * It lived beside the pretty reporter, which is where the counts are printed, and the two
 * callers that needed an irregular plural could not reach it without pulling a colour
 * library into a bug report. So they wrote the ternary out instead, three times for the
 * same word.
 */

/**
 * `plural(1, 'file')` is `1 file`, `plural(2, 'file')` is `2 files`.
 *
 * The third parameter is for the words English does not pluralize by adding an `s`. Only
 * `entry` needs it today, and the alternative was every caller of an irregular word writing
 * the ternary itself.
 */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
