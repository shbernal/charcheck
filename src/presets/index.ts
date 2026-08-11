/**
 * Optional rule sets, outside core.
 *
 * Every preset is a **function taking the targeting**, never a ready-made rule: what to
 * ban is general, where to ban it never is. A preset that baked in globs would be wrong
 * for every repo but the one it was written against.
 */

import {
  EM_DASH,
  EN_DASH,
  FIRST_STRONG_ISOLATE,
  HORIZONTAL_BAR,
  HORIZONTAL_ELLIPSIS,
  LEFT_DOUBLE_QUOTE,
  LEFT_SINGLE_QUOTE,
  LEFT_TO_RIGHT_EMBEDDING,
  LEFT_TO_RIGHT_ISOLATE,
  LEFT_TO_RIGHT_MARK,
  LEFT_TO_RIGHT_OVERRIDE,
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
  POP_DIRECTIONAL_FORMATTING,
  POP_DIRECTIONAL_ISOLATE,
  RIGHT_DOUBLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
  RIGHT_TO_LEFT_EMBEDDING,
  RIGHT_TO_LEFT_ISOLATE,
  RIGHT_TO_LEFT_MARK,
  RIGHT_TO_LEFT_OVERRIDE,
  SOFT_HYPHEN,
  WORD_JOINER,
  ZERO_WIDTH_JOINER,
  ZERO_WIDTH_NON_JOINER,
  ZERO_WIDTH_SPACE,
} from '../chars.js';
import type { Rule, Scope } from '../types.js';

export interface PresetOptions {
  include: string[];
  exclude?: string[];
  scope?: Scope;
  /** Prefixed to each rule id, for a repo running the same preset over two surfaces. */
  idPrefix?: string;
}

function build(options: PresetOptions, id: string, chars: string[], message: string): Rule {
  return {
    id: options.idPrefix ? `${options.idPrefix}/${id}` : id,
    chars,
    message,
    include: options.include,
    ...(options.exclude ? { exclude: options.exclude } : {}),
    ...(options.scope ? { scope: options.scope } : {}),
  };
}

/**
 * The punctuation a word processor or a language model substitutes for the plain ASCII
 * form. No vocabulary opinions: this is about characters, not about words.
 */
export function noAiPunctuation(options: PresetOptions): Rule[] {
  return [
    build(
      options,
      'no-fancy-dashes',
      [EM_DASH, EN_DASH, HORIZONTAL_BAR],
      'Use a plain hyphen, a comma, or reword.',
    ),
    build(
      options,
      'no-smart-quotes',
      [LEFT_SINGLE_QUOTE, RIGHT_SINGLE_QUOTE, LEFT_DOUBLE_QUOTE, RIGHT_DOUBLE_QUOTE],
      'Use a straight quote.',
    ),
    build(options, 'no-ellipsis-character', [HORIZONTAL_ELLIPSIS], 'Use three periods.'),
    build(
      options,
      'no-exotic-spaces',
      [NO_BREAK_SPACE, NARROW_NO_BREAK_SPACE],
      'Use a normal space.',
    ),
  ];
}

/**
 * Characters that are invisible on screen. A reviewer cannot see one, which is what makes
 * them worth a linter rather than a reading.
 */
export function invisibles(options: PresetOptions): Rule[] {
  return [
    build(
      options,
      'no-zero-width',
      [ZERO_WIDTH_SPACE, ZERO_WIDTH_NON_JOINER, ZERO_WIDTH_JOINER, WORD_JOINER, SOFT_HYPHEN],
      'Zero-width character. Delete it.',
    ),
    build(
      options,
      'no-bidi-controls',
      [
        LEFT_TO_RIGHT_MARK,
        RIGHT_TO_LEFT_MARK,
        LEFT_TO_RIGHT_EMBEDDING,
        RIGHT_TO_LEFT_EMBEDDING,
        POP_DIRECTIONAL_FORMATTING,
        LEFT_TO_RIGHT_OVERRIDE,
        RIGHT_TO_LEFT_OVERRIDE,
        LEFT_TO_RIGHT_ISOLATE,
        RIGHT_TO_LEFT_ISOLATE,
        FIRST_STRONG_ISOLATE,
        POP_DIRECTIONAL_ISOLATE,
      ],
      'Bidirectional control character. Delete it.',
    ),
  ];
}
