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

describe('clauseSeparator', () => {
  it('prefers a colon', () => {
    expect(clauseSeparator(context(`a ${EM_DASH} b`))).toBe(': ');
  });

  it('uses a comma when the container already has a colon', () => {
    expect(clauseSeparator(context(`note: a ${EM_DASH} b`))).toBe(', ');
  });

  it('uses a comma when the container holds two or more dashes', () => {
    expect(clauseSeparator(context(`a ${EM_DASH} b ${EM_DASH} c`))).toBe(', ');
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

  it('absorbs the surrounding spaces when paired with the spaced pattern', async () => {
    const text = `one ${EM_DASH} two`;
    const findings = await scanText(
      text,
      'a.md',
      [rule({ id: 'clause', chars: undefined, pattern: spacedDash, fix: clauseSeparator })],
      { assumeText: true },
    );
    expect(applyFixes(text, findings)).toBe('one: two');
  });

  /**
   * The case that motivated the sentence container. Hard-wrapped prose puts the two halves
   * of an aside on different lines, and a fix seeing only one line turns both into colons.
   */
  it('sees both halves of an aside that a line break has split', async () => {
    const text =
      `The fourth state ${EM_DASH} approximated, output that looks about right but has no way\n` +
      `back ${EM_DASH} is what the charter rules out.\n`;
    const findings = await scanText(
      text,
      'a.md',
      [rule({ id: 'clause', chars: undefined, pattern: spacedDash, fix: clauseSeparator })],
      { assumeText: true },
    );
    expect(applyFixes(text, findings)).toBe(
      'The fourth state, approximated, output that looks about right but has no way\n' +
        'back, is what the charter rules out.\n',
    );
  });

  it('still treats two sentences separately', async () => {
    const text = `The loop ${EM_DASH} four functions. The lane ${EM_DASH} one function.\n`;
    const findings = await scanText(
      text,
      'a.md',
      [rule({ id: 'clause', chars: undefined, pattern: spacedDash, fix: clauseSeparator })],
      { assumeText: true },
    );
    expect(applyFixes(text, findings)).toBe('The loop: four functions. The lane: one function.\n');
  });

  it('treats adjacent list items as separate, though no blank line divides them', async () => {
    const text = `- **Modeled** ${EM_DASH} the IR represents it\n- **Carried** ${EM_DASH} it does not\n`;
    const findings = await scanText(
      text,
      'a.md',
      [rule({ id: 'clause', chars: undefined, pattern: spacedDash, fix: clauseSeparator })],
      { assumeText: true },
    );
    expect(applyFixes(text, findings)).toBe(
      '- **Modeled**: the IR represents it\n- **Carried**: it does not\n',
    );
  });

  it('is exposed by name', () => {
    expect(isFixStrategyName('clauseSeparator')).toBe(true);
    expect(isFixStrategyName('nope')).toBe(false);
    expect(fixStrategies.clauseSeparator).toBe(clauseSeparator);
  });
});
