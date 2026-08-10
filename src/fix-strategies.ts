import { EM_DASH, HORIZONTAL_BAR, charClass } from './chars.js';
import type { FixContext, FixFunction } from './types.js';

/** Em dash and the horizontal bar that gets pasted in its place. */
const DASHES = new RegExp(`[${charClass([EM_DASH, HORIZONTAL_BAR])}]`, 'gu');

/**
 * A dash followed by one of these joins two clauses rather than introducing anything, and
 * a colon in front of a conjunction is never grammatical: `made of — and what` has to
 * become `made of, and what`, not `made of: and what`.
 *
 * Deliberately only the coordinators and the two commonest subordinators. A longer list
 * starts making judgements about prose, and every word on it is a word the fix gets wrong
 * when the dash really was introducing something.
 */
const JOINS_CLAUSES = /^(?:and|but|or|nor|so|yet|then|because)\b/i;

/**
 * Turn a dash used as a clause separator into punctuation.
 *
 * A colon reads best, except in three cases where a comma is the safer choice: the dash is
 * followed by a conjunction, the surrounding sentence already has a colon, or it holds
 * several dashes and so is a bracketed aside rather than a single introduction.
 *
 * `ctx.container` is the enclosing sentence for `raw`, and the enclosing literal for
 * `strings` and `markup`. The sentence rather than the line matters: hard-wrapped prose
 * puts the two halves of an aside on different lines, and a fix that can see only one of
 * them turns both into colons.
 *
 * Pair this with a pattern that also matches the surrounding spaces, so the replacement
 * absorbs them instead of leaving a double space behind. The preset rule does this.
 *
 * This is a guess about prose, not a mechanical transformation. Anything applying it has
 * to tell the user to read the diff.
 */
export const clauseSeparator: FixFunction = (ctx: FixContext): string => {
  const after = ctx.container.slice(ctx.index + ctx.match.length);
  if (JOINS_CLAUSES.test(after.trimStart())) return ', ';

  const dashes = ctx.container.match(DASHES)?.length ?? 0;
  const hasColon = ctx.container.includes(':');
  return hasColon || dashes >= 2 ? ', ' : ': ';
};

/** Named strategies, so a config can ask for one by name instead of inlining a function. */
export const fixStrategies = {
  clauseSeparator,
} satisfies Record<string, FixFunction>;

export type FixStrategyName = keyof typeof fixStrategies;

export function isFixStrategyName(value: string): value is FixStrategyName {
  return Object.hasOwn(fixStrategies, value);
}
