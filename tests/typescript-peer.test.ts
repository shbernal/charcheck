/**
 * Which TypeScript API a run reads through, decided once per process from what is installed.
 *
 * Once per process is what makes it hard to test: the first scan anywhere in a worker
 * settles it for every test after. `resetTypeScript` is the seam that lets one file observe
 * all three answers, by swapping what `typescript` resolves to and asking again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnsupportedPeerDependencyError } from '../src/scope/missing-peer.js';
import { loadTypeScript, resetTypeScript } from '../src/scope/typescript-peer.js';

const ts7ast = (await import('typescript-next/unstable/ast' as string)) as object;

afterEach(() => {
  vi.doUnmock('typescript');
  vi.doUnmock('typescript/unstable/ast');
  resetTypeScript();
});

describe('the TypeScript API decision', () => {
  it('reads through the parser when the package has one', async () => {
    expect((await loadTypeScript('strings')).kind).toBe('parser');
  });

  it('falls back to the scanner when only the scanner is left', async () => {
    vi.doMock('typescript', () => ({ default: { version: '7.0.0' } }));
    vi.doMock('typescript/unstable/ast', () => ({ default: ts7ast }));
    resetTypeScript();
    expect((await loadTypeScript('strings')).kind).toBe('scanner');
  });

  it('refuses a package offering neither, naming the version it found', async () => {
    vi.doMock('typescript', () => ({ default: { version: '9.0.0' } }));
    vi.doMock('typescript/unstable/ast', () => ({ default: {} }));
    resetTypeScript();
    const failure = loadTypeScript('comments');
    await expect(failure).rejects.toBeInstanceOf(UnsupportedPeerDependencyError);
    await expect(failure).rejects.toThrow('version 9.0.0');
  });

  it('keeps its answer until reset, then decides again', async () => {
    expect((await loadTypeScript('strings')).kind).toBe('parser');
    vi.doMock('typescript', () => ({ default: { version: '7.0.0' } }));
    vi.doMock('typescript/unstable/ast', () => ({ default: ts7ast }));
    expect((await loadTypeScript('strings')).kind).toBe('parser');
    resetTypeScript();
    expect((await loadTypeScript('strings')).kind).toBe('scanner');
  });
});
