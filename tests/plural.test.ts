import { describe, expect, it } from 'vitest';

import { plural } from '../src/plural.js';

describe('counting in words', () => {
  it('adds an s for the regular case', () => {
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(2, 'file')).toBe('2 files');
  });

  it('takes the plural form for a word English does not treat that way', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
    // The exact strings the baseline messages are asserted on elsewhere.
    expect(plural(1, 'baseline entry', 'baseline entries')).toBe('1 baseline entry');
    expect(plural(2, 'baseline entry', 'baseline entries')).toBe('2 baseline entries');
  });
});
