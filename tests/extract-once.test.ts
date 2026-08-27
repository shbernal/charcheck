/**
 * A file is parsed once per scope, not once per rule.
 *
 * The cheap match gate in front of the parser hides the difference on a tree where most
 * rules match nothing, and stops hiding it exactly when a config is doing its job: a preset
 * is several rules, and a document with prose in it trips several of them. Counted rather
 * than timed, because the count is the property and a timing is a machine.
 */

import { describe, expect, it, vi } from 'vitest';

import { EM_DASH, EN_DASH } from '../src/chars.js';
import type * as scopeModule from '../src/scope/index.js';
import { JsxUnsupportedError } from '../src/scope/missing-peer.js';
import type { Extractor, Scope } from '../src/types.js';

const parses = vi.hoisted(() => ({ scopes: [] as string[] }));

vi.mock('../src/scope/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof scopeModule>();
  return {
    ...original,
    getExtractor: (scope: Scope): Extractor => {
      const extractor = original.getExtractor(scope);
      return (source, file, options) => {
        parses.scopes.push(scope);
        if (file.endsWith('.refused.md')) throw new JsxUnsupportedError(file, scope);
        return extractor(source, file, options);
      };
    },
  };
});

const { scanText } = await import('../src/scan.js');
const { rule } = await import('./helpers.js');

/** Built from its code point, like everything banned in this repository. */
const WORD_JOINER = String.fromCodePoint(0x2060);

const PROSE = `a line with ${EM_DASH} and ${EN_DASH} in it\n`;

async function scan(file: string, rules: Parameters<typeof scanText>[2]): Promise<number> {
  parses.scopes.length = 0;
  const findings = await scanText(PROSE, file, rules, { assumeText: true });
  return findings.length;
}

describe('parsing a file for its rules', () => {
  it('parses once for three rules of one scope', async () => {
    const found = await scan('a.md', [
      rule({ id: 'em', chars: [EM_DASH], scope: 'markdown' }),
      rule({ id: 'en', chars: [EN_DASH], scope: 'markdown' }),
      rule({ id: 'both', chars: [EM_DASH, EN_DASH], scope: 'markdown' }),
    ]);

    expect(parses.scopes).toEqual(['markdown']);
    // The rules still each report what they match; only the parse count changed.
    expect(found).toBe(4);
  });

  it('parses once per scope when two scopes read the same file', async () => {
    await scan('a.md', [
      rule({ id: 'raw-em', chars: [EM_DASH] }),
      rule({ id: 'md-em', chars: [EM_DASH], scope: 'markdown' }),
      rule({ id: 'raw-en', chars: [EN_DASH] }),
      rule({ id: 'md-en', chars: [EN_DASH], scope: 'markdown' }),
    ]);

    expect([...parses.scopes].sort()).toEqual(['markdown', 'raw']);
  });

  it('does not parse for a rule that matches nothing', async () => {
    await scan('a.md', [rule({ id: 'absent', chars: [WORD_JOINER], scope: 'markdown' })]);

    expect(parses.scopes).toEqual([]);
  });

  it('refuses a file it cannot read once, however many rules asked', async () => {
    parses.scopes.length = 0;
    await expect(
      scanText(PROSE, 'a.refused.md', [
        rule({ id: 'em', chars: [EM_DASH], scope: 'markdown' }),
        rule({ id: 'en', chars: [EN_DASH], scope: 'markdown' }),
      ]),
    ).rejects.toBeInstanceOf(JsxUnsupportedError);

    expect(parses.scopes).toEqual(['markdown']);
  });
});
