/**
 * Every banned character this package knows about, named and built from its code point.
 *
 * Constructed rather than written literally, and deliberately so: this repo runs its own
 * binary over its own sources, and a literal here would flag the file that defines the
 * rule. It also keeps the characters legible in review, where several of them are either
 * invisible or indistinguishable from a neighbour.
 */

const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

/** Dashes. */
export const EN_DASH = cp(0x2013);
export const EM_DASH = cp(0x2014);
export const HORIZONTAL_BAR = cp(0x2015);

/** Punctuation a word processor or a model substitutes for the plain ASCII form. */
export const LEFT_SINGLE_QUOTE = cp(0x2018);
export const RIGHT_SINGLE_QUOTE = cp(0x2019);
export const LEFT_DOUBLE_QUOTE = cp(0x201c);
export const RIGHT_DOUBLE_QUOTE = cp(0x201d);
export const HORIZONTAL_ELLIPSIS = cp(0x2026);

/** Bidirectional formatting controls. Invisible, and a way to disguise text. */
export const LEFT_TO_RIGHT_EMBEDDING = cp(0x202a);
export const RIGHT_TO_LEFT_EMBEDDING = cp(0x202b);
export const POP_DIRECTIONAL_FORMATTING = cp(0x202c);
export const LEFT_TO_RIGHT_OVERRIDE = cp(0x202d);
export const RIGHT_TO_LEFT_OVERRIDE = cp(0x202e);
export const LEFT_TO_RIGHT_ISOLATE = cp(0x2066);
export const RIGHT_TO_LEFT_ISOLATE = cp(0x2067);
export const FIRST_STRONG_ISOLATE = cp(0x2068);
export const POP_DIRECTIONAL_ISOLATE = cp(0x2069);

/** Invisibles and lookalike spaces. */
export const NO_BREAK_SPACE = cp(0x00a0);
export const SOFT_HYPHEN = cp(0x00ad);
export const ZERO_WIDTH_SPACE = cp(0x200b);
export const ZERO_WIDTH_NON_JOINER = cp(0x200c);
export const ZERO_WIDTH_JOINER = cp(0x200d);
export const LEFT_TO_RIGHT_MARK = cp(0x200e);
export const RIGHT_TO_LEFT_MARK = cp(0x200f);
export const NARROW_NO_BREAK_SPACE = cp(0x202f);
export const WORD_JOINER = cp(0x2060);
export const BYTE_ORDER_MARK = cp(0xfeff);

/**
 * Code points that render as nothing. A finding on one of these needs its name printed,
 * because an excerpt of the line looks perfectly ordinary and the caret appears to point
 * at empty space.
 */
const INVISIBLE_CODE_POINTS = new Set([
  0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

export function isInvisibleText(value: string): boolean {
  if (value.length === 0) return false;
  return [...value].every(
    (char) => char.trim().length === 0 || INVISIBLE_CODE_POINTS.has(char.codePointAt(0)!),
  );
}

/**
 * Three functions here and in `report/issue.ts` render a code point, and they are not
 * interchangeable. This one writes a character class body for a regular expression,
 * `describeChars` below writes `U+2014` labels for a person reading a message, and
 * `escapeUnicode` in `report/issue.ts` writes a backslash-u escape for text that has to
 * survive a clipboard and an issue form. Reach for the one whose reader you are writing
 * for rather than adding a fourth.
 */

/** A character class body, escaped for use inside `[...]`. */
export function charClass(chars: readonly string[]): string {
  return chars.map((char) => `\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`).join('');
}

/** `U+2014` style labels, for messages about characters you cannot see. */
export function describeChars(value: string): string {
  return [...value]
    .map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}
