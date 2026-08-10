import { describe, expect, it } from 'vitest';

import { EM_DASH, charClass } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { clauseSeparator, fixStrategies, isFixStrategyName } from '../src/fix-strategies.js';
import { scanText } from '../src/scan.js';
import { rule } from './helpers.js';

/** The shape the preset uses: the dash plus the spaces around it. */
const spacedDash = `\\s*[${charClass([EM_DASH])}]\\s*`;

describe('clauseSeparator', () => {
  it('prefers a colon', () => {
    expect(clauseSeparator({ container: `a ${EM_DASH} b`, match: EM_DASH, scope: 'raw' })).toBe(
      ': ',
    );
  });

  it('uses a comma when the container already has a colon', () => {
    expect(
      clauseSeparator({ container: `note: a ${EM_DASH} b`, match: EM_DASH, scope: 'raw' }),
    ).toBe(', ');
  });

  it('uses a comma when the container holds two or more dashes', () => {
    expect(
      clauseSeparator({ container: `a ${EM_DASH} b ${EM_DASH} c`, match: EM_DASH, scope: 'raw' }),
    ).toBe(', ');
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

  it('is exposed by name', () => {
    expect(isFixStrategyName('clauseSeparator')).toBe(true);
    expect(isFixStrategyName('nope')).toBe(false);
    expect(fixStrategies.clauseSeparator).toBe(clauseSeparator);
  });
});
