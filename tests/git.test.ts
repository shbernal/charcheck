import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { prepareCommitMessage } from '../src/commit-msg.js';
import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE, run } from '../src/cli.js';
import type { CliIo } from '../src/cli.js';

const exec = promisify(execFile);

let root: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: root });
  return stdout;
}

async function write(relative: string, contents: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function cli(
  argv: string[],
  cwd = root,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    color: false,
  };
  const code = await run(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const CONFIG = JSON.stringify({
  rules: [
    { id: 'no-em-dash', chars: [EM_DASH], include: ['docs/**/*.md'], fix: '-' },
    { id: 'no-em-dash-in-commit-msg', chars: [EM_DASH], include: ['<commit-msg>'] },
  ],
});

/**
 * One repository for the whole file, restored between tests.
 *
 * Creating a fresh repository per test cost seven seconds each on this machine, which is
 * a suite nobody would run. `git init` and the first commit happen once; a reset is two
 * commands.
 */
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-git-'));
  await git('init', '--initial-branch=main');
  // The tests must not depend on this machine's global git configuration, and Windows
  // checkout translation would rewrite line endings underneath them.
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'user.name', 'charcheck tests');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'commit.gpgsign', 'false');
  // A global `core.hooksPath` would otherwise apply here, and someone's hooks are not this
  // suite's to run. They also make the commits below arbitrarily slow: a hook that shells
  // out looking for a tool it cannot find can cost seconds apiece, which is enough to blow
  // this hook's timeout. Point at a directory that will never exist.
  await git('config', 'core.hooksPath', path.join(root, '.git', 'no-hooks'));

  await write('charcheck.config.json', CONFIG);
  await write('docs/baseline.md', 'clean baseline\n');
  await write('src/code.ts', 'export const x = 1;\n');
  await git('add', '.');
  await git('commit', '-m', 'baseline');
});

beforeEach(async () => {
  await git('reset', '--hard', 'HEAD');
  await git('clean', '-fd');
  await git('config', '--unset', 'core.commentChar').catch(() => undefined);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('--staged', () => {
  it('exits 0 silently when nothing is staged', async () => {
    const result = await cli(['--staged']);
    expect(result.code).toBe(EXIT_OK);
  });

  it('exits 0 when the staged files match no rule', async () => {
    await write('src/code.ts', `// a comment ${EM_DASH} here\n`);
    await git('add', 'src/code.ts');
    const result = await cli(['--staged']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('No banned characters found');
  });

  it('reads the index, not the working tree', async () => {
    // Stage something clean, then dirty the working copy. The commit is fine, so the
    // hook must say so.
    await write('docs/page.md', 'staged clean\n');
    await git('add', 'docs/page.md');
    await write('docs/page.md', `unstaged ${EM_DASH} edit\n`);

    const staged = await cli(['--staged']);
    expect(staged.code).toBe(EXIT_OK);

    // The same tree scanned normally does see the working copy.
    const tree = await cli([]);
    expect(tree.code).toBe(EXIT_FINDINGS);
  });

  it('reports a violation that is actually staged', async () => {
    await write('docs/page.md', `staged ${EM_DASH} problem\n`);
    await git('add', 'docs/page.md');
    const result = await cli(['--staged']);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('docs/page.md:1:8');
  });

  it('survives a filename with a space and a non-ASCII character', async () => {
    await write('docs/a file with spaces é.md', `awkward ${EM_DASH} name\n`);
    await git('add', '.');
    const result = await cli(['--staged']);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('a file with spaces');
  });

  it('runs from a subdirectory of the repository', async () => {
    await write('docs/page.md', `staged ${EM_DASH} problem\n`);
    await git('add', 'docs/page.md');
    const result = await cli(['--staged'], path.join(root, 'src'));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('docs/page.md');
  });

  // The path git reports and the path the process was started from are the same string
  // only when no link is involved. On macOS a temporary directory is reached through
  // /var -> /private/var, and on Windows through an 8.3 alias, which is why this failed
  // there and passed on Linux. A junction needs no elevation, so it stands in for both.
  it('reports a violation when the repository is reached through a link', async () => {
    await write('docs/page.md', `staged ${EM_DASH} problem\n`);
    await git('add', 'docs/page.md');

    const link = path.join(await mkdtemp(path.join(os.tmpdir(), 'charcheck-link-')), 'repo');
    await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');

    const result = await cli(['--staged'], link);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('docs/page.md:1:8');
  });

  it('refuses paths alongside it', async () => {
    const result = await cli(['--staged', 'docs/page.md']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('selects the files itself');
  });

  it('with --fix rewrites the working tree and stages the result', async () => {
    await write('docs/page.md', `staged ${EM_DASH} problem\n`);
    await git('add', 'docs/page.md');

    const result = await cli(['--staged', '--fix']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.err).toContain('re-staged');

    expect(await readFile(path.join(root, 'docs/page.md'), 'utf8')).toBe('staged - problem\n');
    // The index carries the fix too, so the commit about to be made is clean.
    const { stdout } = await exec('git', ['show', ':docs/page.md'], { cwd: root });
    expect(stdout).toBe('staged - problem\n');
    expect((await cli(['--staged'])).code).toBe(EXIT_OK);
  });
});

describe('--commit-msg', () => {
  const messagePath = '.git/COMMIT_EDITMSG';

  async function message(text: string): Promise<void> {
    await write(messagePath, text);
  }

  it('flags a banned character in the message', async () => {
    await message(`subject ${EM_DASH} here\n`);
    const result = await cli(['--commit-msg', messagePath]);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain(':1:9');
  });

  it('ignores comment lines', async () => {
    await message(`clean subject\n\n# a comment ${EM_DASH} from git\n`);
    expect((await cli(['--commit-msg', messagePath])).code).toBe(EXIT_OK);
  });

  it('ignores the diff below the scissors', async () => {
    await message(
      [
        'clean subject',
        '',
        '# ------------------------ >8 ------------------------',
        '# Do not modify or remove the line above.',
        'diff --git a/x b/x',
        `+const label = "code ${EM_DASH} being committed";`,
        '',
      ].join('\n'),
    );
    expect((await cli(['--commit-msg', messagePath])).code).toBe(EXIT_OK);
  });

  it('keeps positions pointing at the original line', async () => {
    await message(
      ['# a comment', '# another comment', '', `subject ${EM_DASH} here`, ''].join('\n'),
    );
    const result = await cli(['--commit-msg', messagePath]);
    expect(result.out).toContain(':4:9');
    // The excerpt is the real line, not the blanked copy.
    expect(result.out).toContain(`subject ${EM_DASH} here`);
  });

  it('skips messages git wrote itself', async () => {
    for (const subject of ['Merge branch main', 'Revert "a change"', 'fixup! a change']) {
      await message(`${subject} ${EM_DASH} generated\n`);
      const result = await cli(['--commit-msg', messagePath]);
      expect(result.code, subject).toBe(EXIT_OK);
    }
  });

  it('honours a custom core.commentChar', async () => {
    await git('config', 'core.commentChar', ';');
    await message(`clean subject\n; a comment ${EM_DASH} here\n`);
    expect((await cli(['--commit-msg', messagePath])).code).toBe(EXIT_OK);
  });

  it('exits 0 when no rule targets a commit message', async () => {
    await write(
      'charcheck.config.json',
      JSON.stringify({ rules: [{ id: 'files', chars: [EM_DASH], include: ['docs/**/*.md'] }] }),
    );
    await message(`subject ${EM_DASH} here\n`);
    expect((await cli(['--commit-msg', messagePath])).code).toBe(EXIT_OK);
  });

  it('refuses --fix', async () => {
    await message('subject\n');
    const result = await cli(['--commit-msg', messagePath, '--fix']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('--fix is refused');
  });

  it('refuses to be combined with --staged', async () => {
    const result = await cli(['--commit-msg', messagePath, '--staged']);
    expect(result.code).toBe(EXIT_USAGE);
  });

  it('reports an unreadable message path as a usage error', async () => {
    const result = await cli(['--commit-msg', '.git/NOPE']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('cannot read the commit message');
  });
});

describe('commit message preparation', () => {
  it('blanks ignorable text without moving any position', () => {
    const text = ['# comment', 'subject', '# ---- >8 ----', 'diff'].join('\n');
    const { masked } = prepareCommitMessage(text, '#');
    expect(masked).toHaveLength(text.length);
    expect(masked.split('\n')).toHaveLength(text.split('\n').length);
    expect(masked.split('\n')[1]).toBe('subject');
    expect(masked.split('\n')[0]!.trim()).toBe('');
    expect(masked.split('\n')[3]!.trim()).toBe('');
  });

  it('detects the comment character from the scissors when it is auto', () => {
    const text = ['subject', '; ------------------------ >8 ------------------------', 'diff'].join(
      '\n',
    );
    const { masked } = prepareCommitMessage(text, ';');
    expect(masked.split('\n')[2]!.trim()).toBe('');
  });
});
