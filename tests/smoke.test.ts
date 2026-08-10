import { describe, expect, it } from 'vitest';

import { name } from '../src/index.js';

describe('package entry', () => {
  it('exports its name', () => {
    expect(name).toBe('charcheck');
  });
});
