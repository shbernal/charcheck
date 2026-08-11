import { describe, expect, it } from 'vitest';

import { EM_DASH, charClass } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { clauseSeparator, fixStrategies, isFixStrategyName } from '../src/fix-strategies.js';
import { scanText } from '../src/scan.js';
import type { FixContext } from '../src/types.js';
import { rule } from './helpers.js';

/** The shape the preset uses: the dash plus the spaces around it. */
const spacedDash = `\\s*[${charClass([EM_DASH])}]\\s*`;

/** `index` defaults to the first dash, which is the one every single-dash case means. */
function context(container: string, index = container.indexOf(EM_DASH)): FixContext {
  return { container, match: EM_DASH, index, scope: 'raw' };
}

/** Scan and fix `text` with the preset's rule shape, which is how a user meets this. */
async function fixed(text: string): Promise<string> {
  const findings = await scanText(
    text,
    'a.md',
    [rule({ id: 'clause', chars: undefined, pattern: spacedDash, fix: clauseSeparator })],
    { assumeText: true },
  );
  return applyFixes(text, findings);
}

describe('clauseSeparator', () => {
  it('prefers a colon', () => {
    expect(clauseSeparator(context(`a ${EM_DASH} b`))).toBe(': ');
  });

  it('uses a comma when the container already has a colon', () => {
    expect(clauseSeparator(context(`note: a ${EM_DASH} b`))).toBe(', ');
  });

  // A colon in front of a conjunction is never grammatical, whatever else the sentence holds.
  describe('a dash joining two clauses', () => {
    it('becomes a comma rather than a colon', () => {
      expect(clauseSeparator(context(`made of ${EM_DASH} and what the rest is`))).toBe(', ');
      expect(clauseSeparator(context(`answers ${EM_DASH} so a default applies`))).toBe(', ');
      expect(clauseSeparator(context(`inches ${EM_DASH} or both`))).toBe(', ');
    });

    it('is judged from its own position, not the first dash in the container', () => {
      const container = `a ${EM_DASH} b. Storing it ${EM_DASH} and reading it`;
      expect(clauseSeparator(context(container, container.lastIndexOf(EM_DASH)))).toBe(', ');
    });

    it('does not fire on a word that merely starts with one', () => {
      expect(clauseSeparator(context(`the state ${EM_DASH} android output`))).toBe(': ');
      expect(clauseSeparator(context(`the state ${EM_DASH} sole authority`))).toBe(': ');
    });
  });

  /**
   * A comma cannot do what a dash pair was doing, because a comma does not bracket. An
   * aside carrying its own commas became a flat list, and the sentence lost its verb.
   */
  describe('a pair of dashes bracketing an aside', () => {
    it('becomes a pair of parentheses', async () => {
      const text =
        `Hash the projection, or every browser normalization ${EM_DASH} attribute order, ` +
        `whitespace, colour serialization ${EM_DASH} reads as an edit.\n`;
      expect(await fixed(text)).toBe(
        'Hash the projection, or every browser normalization (attribute order, ' +
          'whitespace, colour serialization) reads as an edit.\n',
      );
    });

    it('is opened or closed according to the position of this dash', () => {
      const container = `a ${EM_DASH} b ${EM_DASH} c`;
      expect(clauseSeparator(context(container))).toBe(' (');
      expect(clauseSeparator(context(container, container.lastIndexOf(EM_DASH)))).toBe(') ');
    });

    it('closes without a space when the sentence ends right after it', async () => {
      const text = `The state ${EM_DASH} approximated, and no way back ${EM_DASH}.\n`;
      expect(await fixed(text)).toBe('The state (approximated, and no way back).\n');
    });

    it('brackets even when the sentence already holds a colon', async () => {
      const text = `Note: the state ${EM_DASH} approximated, no way back ${EM_DASH} is ruled out.\n`;
      expect(await fixed(text)).toBe('Note: the state (approximated, no way back) is ruled out.\n');
    });

    /**
     * Two dashes are only a pair inside one sentence. A `raw` container is a sentence, but
     * the literal a `strings` rule gets can hold several, and those are two introductions.
     */
    it('is not read across a sentence ending inside the container', () => {
      const container = `The loop ${EM_DASH} four functions. The lane ${EM_DASH} one function.`;
      expect(clauseSeparator(context(container))).toBe(', ');
      expect(clauseSeparator(context(container, container.lastIndexOf(EM_DASH)))).toBe(', ');
    });

    it('falls back to a comma when there are more dashes than a pair', () => {
      expect(clauseSeparator(context(`a ${EM_DASH} b ${EM_DASH} c ${EM_DASH} d`))).toBe(', ');
    });
  });

  /**
   * The colon test asks whether the sentence already has a colon doing the introducing.
   * Colons that are not punctuation say nothing about that, and counting them turned a
   * dash that really was introducing a clause into a comma splice.
   */
  describe('a colon that is not sentence punctuation', () => {
    it('is ignored inside a Markdown link target', async () => {
      const text =
        `The oracle gates decks written by [ts-pptx](https://npmjs.com/package/ts-pptx) ` +
        `${EM_DASH} the samples above are that corpus.\n`;
      expect(await fixed(text)).toBe(
        'The oracle gates decks written by [ts-pptx](https://npmjs.com/package/ts-pptx): ' +
          'the samples above are that corpus.\n',
      );
    });

    it('is ignored inside a bare URL', () => {
      const container = `See https://example.com/a ${EM_DASH} the second half is a clause`;
      expect(clauseSeparator(context(container))).toBe(': ');
    });

    it('is ignored inside an inline code span', () => {
      const container = `Set \`display: block\` ${EM_DASH} the rest follows from it`;
      expect(clauseSeparator(context(container))).toBe(': ');
    });

    it('is ignored inside a braced block, which is what a stylesheet looks like', () => {
      const container = `body { display: block; margin: 0 } ${EM_DASH} the reset does the rest`;
      expect(clauseSeparator(context(container))).toBe(': ');
    });

    it('still counts a real one', () => {
      expect(clauseSeparator(context(`One thing: a \`code\` span ${EM_DASH} and more`))).toBe(', ');
    });
  });

  /**
   * A colon can only have introduced something if it came first. Counting one further along
   * the sentence downgraded a dash that was doing real work, and the commonest such colon is
   * the one ending a sentence that introduces a code block, which is dense in exactly the
   * documentation these rules are pointed at.
   */
  describe('a colon that comes after the dash', () => {
    it('does not count as the one already introducing', () => {
      const container = `Annotate the header cells ${EM_DASH} these win outright on every path:`;
      expect(clauseSeparator(context(container))).toBe(': ');
    });

    it('still counts once the dash is past it', () => {
      const container = `Annotate them: the header cells ${EM_DASH} these win outright`;
      expect(clauseSeparator(context(container))).toBe(', ');
    });
  });

  it('absorbs the surrounding spaces when paired with the spaced pattern', async () => {
    expect(await fixed(`one ${EM_DASH} two`)).toBe('one: two');
  });

  /**
   * The case that motivated the sentence container. Hard-wrapped prose puts the two halves
   * of an aside on different lines, and a fix seeing only one line cannot tell it is one.
   */
  it('sees both halves of an aside that a line break has split', async () => {
    const text =
      `The fourth state ${EM_DASH} approximated, output that looks about right but has no way\n` +
      `back ${EM_DASH} is what the charter rules out.\n`;
    expect(await fixed(text)).toBe(
      'The fourth state (approximated, output that looks about right but has no way\n' +
        'back) is what the charter rules out.\n',
    );
  });

  /**
   * Matching the whitespace around the dash is what keeps the replacement from leaving a
   * double space, but in hard-wrapped prose that whitespace is sometimes a line break.
   * Swallowing it left the paragraph past its wrap column, and nothing said so.
   */
  describe('a dash at a line boundary', () => {
    it('keeps the break when the dash starts the line', async () => {
      const text =
        'JSON is the wire format, so there is no `Date`, and no `Uint8Array`\n' +
        `${EM_DASH} media lives behind an \`AssetRef\` and is addressed by hash.\n`;
      expect(await fixed(text)).toBe(
        'JSON is the wire format, so there is no `Date`, and no `Uint8Array`:\n' +
          'media lives behind an `AssetRef` and is addressed by hash.\n',
      );
    });

    it('keeps the break when the dash ends the line', async () => {
      const text = `The wire format is JSON ${EM_DASH}\nmedia lives behind a reference.\n`;
      expect(await fixed(text)).toBe('The wire format is JSON:\nmedia lives behind a reference.\n');
    });

    it('adds no space when the line ends just outside the match', () => {
      // A region that closes on the dash leaves the break outside the match, so `place` has
      // no break to put back and has to read the container instead. A space there is
      // trailing whitespace, and two of them are a hard line break in Markdown.
      expect(clauseSeparator(context(`a ${EM_DASH}\nb`))).toBe(':');
      expect(clauseSeparator(context(`a ${EM_DASH}\r\nb`))).toBe(':');
    });

    it('keeps the indent of the line the break lands on', async () => {
      const text = `- The wire format is JSON\n  ${EM_DASH} media lives behind a reference.\n`;
      expect(await fixed(text)).toBe(
        '- The wire format is JSON:\n  media lives behind a reference.\n',
      );
    });

    it('leaves the paragraph with the lines it had', async () => {
      const text =
        'JSON is the wire format, so there is no `Date`, and no `Uint8Array`\n' +
        `${EM_DASH} media lives behind an \`AssetRef\` and is addressed by hash.\n`;
      expect((await fixed(text)).split('\n')).toHaveLength(text.split('\n').length);
    });

    // Putting an LF back where a CRLF was rewrites a line ending under the author, which is
    // the one thing a fixer is never allowed to do quietly.
    it('keeps the break spelled the way the file spells it', async () => {
      const starts = `The wire format is JSON\r\n${EM_DASH} media lives behind a reference.\r\n`;
      expect(await fixed(starts)).toBe(
        'The wire format is JSON:\r\nmedia lives behind a reference.\r\n',
      );

      const ends = `The wire format is JSON ${EM_DASH}\r\nmedia lives behind a reference.\r\n`;
      expect(await fixed(ends)).toBe(
        'The wire format is JSON:\r\nmedia lives behind a reference.\r\n',
      );
    });
  });

  it('still treats two sentences separately', async () => {
    const text = `The loop ${EM_DASH} four functions. The lane ${EM_DASH} one function.\n`;
    expect(await fixed(text)).toBe('The loop: four functions. The lane: one function.\n');
  });

  it('treats adjacent list items as separate, though no blank line divides them', async () => {
    const text = `- **Modeled** ${EM_DASH} the IR represents it\n- **Carried** ${EM_DASH} it does not\n`;
    expect(await fixed(text)).toBe(
      '- **Modeled**: the IR represents it\n- **Carried**: it does not\n',
    );
  });

  it('is exposed by name', () => {
    expect(isFixStrategyName('clauseSeparator')).toBe(true);
    expect(isFixStrategyName('nope')).toBe(false);
    expect(fixStrategies.clauseSeparator).toBe(clauseSeparator);
  });
});
