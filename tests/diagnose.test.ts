// TEMPORARY. Prints the values the staged path depends on, to find out why Windows CI
// disagrees with every other platform. Deleted once the cause is known.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { glob } from 'tinyglobby';
import { it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { loadConfig } from '../src/config/load.js';
import { repoRoot, stagedFiles } from '../src/git.js';
import { relativeToRoot, toPosix } from '../src/paths.js';

const exec = promisify(execFile);

it('prints the staged path inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-diag-'));
  const git = async (...args: string[]): Promise<string> =>
    (await exec('git', args, { cwd: root })).stdout;

  await git('init', '--initial-branch=main');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'user.name', 'diag');
  await git('config', 'core.hooksPath', path.join(root, '.git', 'no-hooks'));

  await writeFile(
    path.join(root, 'charcheck.config.json'),
    JSON.stringify({ rules: [{ id: 'r', chars: [EM_DASH], include: ['docs/**/*.md'] }] }),
    'utf8',
  );
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'page.md'), `staged ${EM_DASH} problem\n`, 'utf8');
  await git('add', '.');

  const loaded = await loadConfig({ from: root });
  const gitRoot = await repoRoot(root);
  const staged = await stagedFiles(root);
  const globbed = await glob({
    patterns: ['docs/**/*.md'],
    cwd: loaded.root,
    onlyFiles: true,
    absolute: false,
    dot: false,
    expandDirectories: false,
  });

  const canonical = (t: string): string => {
    try {
      return toPosix(realpathSync(t));
    } catch {
      return `THREW:${toPosix(path.resolve(t))}`;
    }
  };

  const data = {
    platform: process.platform,
    mkdtempRoot: root,
    loadedRoot: loaded.root,
    gitRoot,
    canonicalGitRoot: canonical(gitRoot),
    canonicalLoadedRoot: canonical(loaded.root),
    staged,
    globbed,
    restriction: staged.map((f) =>
      relativeToRoot(canonical(loaded.root), path.resolve(canonical(gitRoot), f)),
    ),
  };

  // Thrown rather than logged: vitest intercepts stdout, but an error message always
  // reaches the CI log.
  throw new Error(`DIAGNOSTIC ${JSON.stringify(data)}`);
});
