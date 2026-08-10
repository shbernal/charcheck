import { EM_DASH, HORIZONTAL_BAR, charClass } from './chars.js';
import type { FixContext, FixFunction } from './types.js';

/** Em dash and the horizontal bar that gets pasted in its place. */
const DASHES = new RegExp(`[${charClass([EM_DASH, HORIZONTAL_BAR])}]`, 'gu');

/**
 * Turn a dash used as a clause separator into punctuation.
 *
 * A colon reads best, except where the surrounding text already has one, or holds several
 * dashes and so is a list rather than a single aside; a comma is the safer choice there.
 *
 * Pair this with a pattern that also matches the surrounding spaces, so the replacement
 * absorbs them instead of leaving a double space behind. The preset rule does this.
 *
 * This is a guess about prose, not a mechanical transformation. Anything applying it has
 * to tell the user to read the diff.
 */
export const clauseSeparator: FixFunction = (ctx: FixContext): string => {
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
