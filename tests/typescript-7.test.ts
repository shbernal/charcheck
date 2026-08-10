import { describe, expect, it, vi } from 'vitest';

// TypeScript 7 resolves like any other install and then hands back a namespace holding a
// version and nothing else: the compiler API moved to `typescript/unstable/ast` and changed
// shape. That is recreated here rather than installed, so the suite keeps working on a
// supported TypeScript while still covering the case.
vi.mock('typescript', () => ({
  default: { version: '7.0.2', versionMajorMinor: '7.0' },
}));

import { UnsupportedPeerDependencyError } from '../src/scope/missing-peer.js';
import { loadTypeScript, SUPPORTED_TYPESCRIPT } from '../src/scope/strings.js';
import { scanText } from '../src/scan.js';
import { EM_DASH } from '../src/chars.js';
import { rule } from './helpers.js';

describe('a typescript without the compiler API', () => {
  it('is rejected rather than called into', async () => {
    await expect(loadTypeScript('strings')).rejects.toThrow(UnsupportedPeerDependencyError);
  });

  it('names the installed version and the range that would work', async () => {
    const error = await loadTypeScript('strings').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UnsupportedPeerDependencyError);
    expect((error as Error).message).toContain('7.0.2');
    expect((error as Error).message).toContain(SUPPORTED_TYPESCRIPT);
    expect((error as Error).message).toContain('strings');
  });

  it('reaches a caller of the strings scope as that error, not a type error', async () => {
    const thrown = await scanText(`const s = "a ${EM_DASH} b";\n`, 'a.ts', [
      rule({ id: 'dash', scope: 'strings' }),
    ]).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(UnsupportedPeerDependencyError);
  });
});
