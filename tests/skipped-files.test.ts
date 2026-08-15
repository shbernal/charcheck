/**
 * A file a rule targets and no scope can read.
 *
 * Today that means JSX on a TypeScript that ships only a scanner, which cannot be told it
 * is inside an element. The refusal itself is right; what matters here is what it does to
 * the rest of the run. Thrown out of the scan it took the whole report with it, so one
 * unreadable component hid every finding in every other file, and it fired only once a
 * banned character reached that component, because nothing reaches a parser before then.
 *
 * The refusal is reached through a mock rather than a second TypeScript, because the two
 * readers are exercised against the real compilers in `typescript-7.test.ts`, and what is
 * under test here is the scan's response rather than the scanner's judgement.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import type * as scanModule from '../src/scan.js';
import { JsxUnsupportedError } from '../src/scope/missing-peer.js';
import type { Finding, Rule } from '../src/types.js';

vi.mock('../src/scan.js', async (importOriginal) => {
  const original = await importOriginal<typeof scanModule>();
  return {
    ...original,
    scanText: async (
      text: string,
      file: string,
      rules: readonly Rule[],
      options?: Parameters<typeof original.scanText>[3],
    ): Promise<Finding[]> => {
      if (file.endsWith('.tsx')) throw new JsxUnsupportedError(file, 'strings');
      if (file.endsWith('.boom.ts')) throw new Error('a real failure, not a refusal');
      return original.scanText(text, file, rules, options);
    },
  };
});

const { scan } = await import('../src/scan-files.js');
const { EXIT_OK, EXIT_USAGE, run } = await import('../src/cli.js');
const { rule } = await import('./helpers.js');

let root: string;

async function write(relative: string, contents: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-skip-'));
  await write('src/Card.tsx', `const a = "text ${EM_DASH}";\n`);
  await write('src/plain.ts', `const b = "text ${EM_DASH}";\n`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a file no scope can read', () => {
  it('does not stop the files that can be read from being reported', async () => {
    const skipped: string[] = [];
    const findings = await scan({
      root,
      rules: [rule({ id: 'dash', include: ['src/**/*.{ts,tsx}'] })],
      onSkipped: (file) => skipped.push(file),
    });

    expect(findings.map((finding) => finding.file)).toEqual(['src/plain.ts']);
    expect(skipped).toEqual(['src/Card.tsx']);
  });

  it('is handed to the caller with the error that refused it', async () => {
    const seen: Error[] = [];
    await scan({
      root,
      rules: [rule({ id: 'dash', include: ['src/**/*.tsx'] })],
      onSkipped: (_file, error) => seen.push(error),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(JsxUnsupportedError);
    expect(seen[0]?.message).toContain('src/Card.tsx');
  });

  it('still throws anything that is not a refusal, since that is a real failure', async () => {
    await write('src/wrong.boom.ts', `const c = "text ${EM_DASH}";\n`);
    await expect(
      scan({
        root,
        rules: [rule({ id: 'dash', include: ['src/**/*.boom.ts'] })],
      }),
    ).rejects.toThrow('a real failure, not a refusal');
  });
});

describe('the cli, over a file no scope can read', () => {
  const config = (include: string): string =>
    JSON.stringify({ rules: [{ id: 'dash', chars: [EM_DASH], include: [include] }] });

  it('names the file and refuses to call the run a pass', async () => {
    await write('charcheck.config.json', config('src/**/*.tsx'));
    const err: string[] = [];
    const code = await run([], {
      cwd: root,
      out: () => undefined,
      err: (text) => err.push(text),
      color: false,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(err.join('\n')).toContain('src/Card.tsx');
    expect(err.join('\n')).toContain('not a pass');
  });

  it('refuses to record a baseline, which would call the unread file clean', async () => {
    await write('charcheck.config.json', config('src/**/*.{ts,tsx}'));
    const err: string[] = [];
    const code = await run(['--baseline-write'], {
      cwd: root,
      out: () => undefined,
      err: (text) => err.push(text),
      color: false,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(err.join('\n')).toContain('refusing to write the baseline');
    await expect(readFile(path.join(root, 'charcheck-baseline.json'), 'utf8')).rejects.toThrow();
  });

  it('passes when every targeted file could be read', async () => {
    await write('charcheck.config.json', config('src/**/*.md'));
    const code = await run([], {
      cwd: root,
      out: () => undefined,
      err: () => undefined,
      color: false,
    });

    expect(code).toBe(EXIT_OK);
  });
});
