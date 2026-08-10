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
