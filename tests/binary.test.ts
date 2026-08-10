import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'dist', 'cli.js');

/**
 * These drive the built binary as a real child process, which is the only way to catch a
 * whole class of bug the in-process tests cannot see: anything that stops `run` from being
 * called at all. That failure is silent, exits 0, and makes every check appear to pass.
 *
 * Skipped when there is no build yet, since `check` runs tests before it builds.
 */
describe.skipIf(!existsSync(CLI))('the built binary', () => {
  it('produces output and a zero exit for --version', async () => {
    const { stdout } = await exec(process.execPath, [CLI, '--version'], { cwd: REPO });
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('actually scans when run as a program, rather than exiting silently', async () => {
    // A no-op binary would exit 0 with empty output and look like a pass.
    const { stdout } = await exec(process.execPath, [CLI], { cwd: REPO });
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stdout).toContain('No banned characters found');
  });

  it('keeps the shebang, so the bin is executable', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(CLI, 'utf8');
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
