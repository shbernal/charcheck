import { EM_DASH } from '../src/chars.js';
import type { Rule } from '../src/types.js';

/** A rule with the boilerplate filled in, since `scanText` ignores globs anyway. */
export function rule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    chars: [EM_DASH],
    include: ['**/*'],
    ...overrides,
  };
}

export const emDashRule = rule({ id: 'no-em-dash' });
