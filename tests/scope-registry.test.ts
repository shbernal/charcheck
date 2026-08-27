/**
 * The one table a scope is defined in.
 *
 * Its totality is a compile-time property and nothing here can replace that. What is worth
 * pinning at runtime is the decision the type cannot state: `raw` reads anything, every
 * other scope reads a listed set, and a scope that failed to say which would silently
 * inherit `raw`'s answer and take two config checks quiet with it.
 */

import { describe, expect, it } from 'vitest';

import {
  getExtractor,
  peersForScopes,
  SCOPE_NAMES,
  scopeExtensions,
  scopeSupportsFile,
} from '../src/scope/index.js';

describe('the scope registry', () => {
  it('names every scope and has an extractor for each', () => {
    expect([...SCOPE_NAMES].sort()).toEqual([
      'comments',
      'html',
      'markdown',
      'markup',
      'raw',
      'strings',
    ]);
    for (const scope of SCOPE_NAMES) expect(typeof getExtractor(scope)).toBe('function');
  });

  it('leaves raw unrestricted, as a written-down decision rather than an omission', () => {
    expect(scopeExtensions('raw')).toBeNull();
    for (const file of ['a.png', 'a.ts', 'a.md', 'LICENSE']) {
      expect(scopeSupportsFile('raw', file), file).toBe(true);
    }
  });

  it('restricts every parser-backed scope, which is the check that used to go quiet', () => {
    for (const scope of SCOPE_NAMES.filter((name) => name !== 'raw')) {
      const extensions = scopeExtensions(scope);
      expect(extensions, scope).not.toBeNull();
      expect(extensions?.length, scope).toBeGreaterThan(0);
    }
  });

  it('answers for the peers a set of scopes needs between them, once each', () => {
    expect(peersForScopes(['raw'])).toEqual([]);
    expect(peersForScopes(['strings', 'comments'])).toEqual(['typescript']);
    expect(peersForScopes(['markup', 'markdown'])).toEqual([
      '@vue/compiler-sfc',
      'micromark',
      'typescript',
    ]);
  });
});
