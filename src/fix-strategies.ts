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
 * Spans of a container that are not prose, and whose punctuation therefore says nothing
 * about how the sentence is punctuated: an inline code span, a Markdown link or image
 * target, a bare URL, and a braced block, which is what a stylesheet, a JSON fragment or a
 * template interpolation looks like from here.
 *
 * The colons inside them are the ones that used to make `clauseSeparator` write a comma
 * into a sentence that had no sentence-level colon at all, which is a splice. One Markdown
 * link in the line was enough.
 */
const NOT_PROSE = /`[^`]*`|\]\([^)\n]*\)|\w+:\/\/\S*|\{[^{}]*\}/gu;

/**
 * Blank out the spans above, keeping the length so offsets into the mask are still offsets
 * into the container. Newlines go too, which costs nothing: the mask is only ever read for
 * the colons and dashes it still holds.
 */
function maskNonProse(container: string): string {
  return container.replace(NOT_PROSE, (span) => ' '.repeat(span.length));
}

/** Offsets of every prose dash in the container, in order. */
function dashOffsets(masked: string): number[] {
  const offsets: number[] = [];
  DASHES.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DASHES.exec(masked)) !== null) offsets.push(match.index);
  return offsets;
}

/** Punctuation that ends the clause before it, so a space after it would be wrong. */
const CLOSING_PUNCTUATION = /^[.,;:!?)\]}]/;

/**
 * Which half of a bracketing pair this dash is, or `null` when it is not one.
 *
 * Exactly two dashes in a sentence is an aside: `normalization — a, b, c — reads as an
 * edit`. A comma cannot do what the pair was doing, because a comma does not bracket, and
 * an aside holding its own commas collapses into a flat list that loses the sentence's
 * verb. Three or more dashes is no longer a pair anybody can identify, so it falls back.
 *
 * Two dashes with a sentence ending between them are two introductions rather than a pair.
 * A `raw` container cannot hold that, since it is one sentence, but the literal a `strings`
 * or `markup` rule gets can hold several.
 */
function bracketHalf(ctx: FixContext, masked: string): '(' | ')' | null {
  const dashes = dashOffsets(masked);
  if (dashes.length !== 2) return null;
  if (/[.!?]\s/.test(masked.slice(dashes[0]! + 1, dashes[1]!))) return null;
  const end = ctx.index + ctx.match.length;
  if (dashes[0]! >= ctx.index && dashes[0]! < end) return '(';
  if (dashes[1]! >= ctx.index && dashes[1]! < end) return ')';
  return null;
}

/**
 * A colon reads best, except in three cases where a comma is the safer choice: the dash is
 * followed by a conjunction, the sentence already has a colon doing the introducing, or the
 * dash is one of a pair and the bracket could not be kept.
 */
function choosePunctuation(ctx: FixContext, masked: string): string {
  const bracket = bracketHalf(ctx, masked);
  if (bracket !== null) return bracket;

  const after = ctx.container.slice(ctx.index + ctx.match.length);
  if (JOINS_CLAUSES.test(after.trimStart())) return ',';

  return masked.includes(':') || dashOffsets(masked).length >= 2 ? ',' : ':';
}

/**
 * Put the punctuation back where the dash and its whitespace were.
 *
 * When that whitespace held a line break, the break is kept: a fix that swallowed it joined
 * two lines of hard-wrapped prose and left the paragraph past its wrap column, silently,
 * since the diff shows only the replacement and the damage is to a line nobody is looking
 * at. Keeping it never lengthens a line, and a dash sitting at a line edge on its own is
 * already correctly wrapped once the punctuation takes its place.
 */
function place(punctuation: string, ctx: FixContext): string {
  DASHES.lastIndex = 0;
  const dash = DASHES.exec(ctx.match);
  const before = dash === null ? '' : ctx.match.slice(0, dash.index);
  const after = dash === null ? '' : ctx.match.slice(dash.index + dash[0].length);

  // The opening bracket belongs to the text after it. Everything else closes the text
  // before it, so it goes on the other side of the break.
  const opensBracket = punctuation === '(';

  const wrapped = after.includes('\n') ? after : before.includes('\n') ? before : null;
  if (wrapped !== null) {
    const line = wrapped.slice(wrapped.indexOf('\n'));
    return opensBracket ? line + punctuation : punctuation + line;
  }

  const rest = ctx.container.slice(ctx.index + ctx.match.length);
  if (opensBracket) return ctx.index === 0 ? punctuation : ` ${punctuation}`;
  return rest === '' || CLOSING_PUNCTUATION.test(rest) ? punctuation : `${punctuation} `;
}

/**
 * Turn a dash used as a clause separator into punctuation.
 *
 * A pair of dashes bracketing an aside becomes a pair of parentheses. A lone dash becomes a
 * colon, or a comma where a colon would be ungrammatical or would be the sentence's second.
 *
 * `ctx.container` is the enclosing sentence for `raw`, and the enclosing literal for
 * `strings` and `markup`. The sentence rather than the line matters: hard-wrapped prose
 * puts the two halves of an aside on different lines, and a fix that can see only one of
 * them cannot tell it is looking at a pair.
 *
 * Pair this with a pattern that also matches the surrounding whitespace, as the example in
 * `docs/configuration.md` does, so the replacement absorbs it instead of leaving a double
 * space behind. Matching `\s` rather than `[ \t]` is safe: a line break inside the match is
 * put back rather than swallowed.
 *
 * This is a guess about prose, not a mechanical transformation. Anything applying it has
 * to tell the user to read the diff.
 */
export const clauseSeparator: FixFunction = (ctx: FixContext): string => {
  const masked = maskNonProse(ctx.container);
  return place(choosePunctuation(ctx, masked), ctx);
};

/** Named strategies, so a config can ask for one by name instead of inlining a function. */
export const fixStrategies = {
  clauseSeparator,
} satisfies Record<string, FixFunction>;

export type FixStrategyName = keyof typeof fixStrategies;

export function isFixStrategyName(value: string): value is FixStrategyName {
  return Object.hasOwn(fixStrategies, value);
}
