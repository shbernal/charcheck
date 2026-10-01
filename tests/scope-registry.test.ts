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
import { importPeer, MissingPeerDependencyError } from '../src/scope/missing-peer.js';

describe('the scope registry', () => {
  it('names every scope and has an extractor for each', () => {
    expect([...SCOPE_NAMES].toSorted()).toEqual([
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

/**
 * The lazy import every peer goes through. Only a module that cannot be found is a missing
 * peer: anything else thrown while loading one is a broken install, and dressing it up as
 * "not installed" would send the user to install what they already have.
 */
describe('importing a peer', () => {
  const thrown = (code: string): Error => Object.assign(new Error('load failed'), { code });

  it('names the package and the scope when the module cannot be found', async () => {
    for (const code of ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']) {
      const failure = importPeer('micromark', 'markdown', () => Promise.reject(thrown(code)));
      await expect(failure).rejects.toBeInstanceOf(MissingPeerDependencyError);
      await expect(failure).rejects.toThrow('"markdown" scope needs the optional peer');
    }
  });

  it('lets any other failure through as itself', async () => {
    const broken = thrown('ERR_INVALID_PACKAGE_CONFIG');
    await expect(importPeer('micromark', 'markdown', () => Promise.reject(broken))).rejects.toBe(
      broken,
    );
  });

  it('returns the module when it loads', async () => {
    await expect(importPeer('micromark', 'markdown', () => Promise.resolve(42))).resolves.toBe(42);
  });
});
