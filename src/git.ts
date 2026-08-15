import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { toPosix } from './paths.js';

const run = promisify(execFile);

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

const MAX_BUFFER = 64 * 1024 * 1024;

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr;
    throw new GitError(
      `git ${args[0] ?? ''} failed: ${(stderr ?? (cause as Error).message).trim()}`,
    );
  }
}

/** Bytes, for content that must not be mangled before it is decoded once as UTF-8. */
async function gitBuffer(args: string[], cwd: string): Promise<Buffer> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER, encoding: 'buffer' });
    return stdout;
  } catch (cause) {
    const stderr = (cause as { stderr?: Buffer }).stderr;
    throw new GitError(
      `git ${args[0] ?? ''} failed: ${(stderr?.toString('utf8') ?? (cause as Error).message).trim()}`,
    );
  }
}

/**
 * The repository root, POSIX. Hooks run at the root but a developer running a package
 * script may be several directories down, and both must behave identically.
 */
export async function repoRoot(cwd: string): Promise<string> {
  return toPosix((await git(['rev-parse', '--show-toplevel'], cwd)).trim());
}

/**
 * Paths staged for commit, relative to the repository root.
 *
 * `-z` because a filename may contain a space, a quote or a newline, and the default
 * quoting of non-ASCII names would otherwise have to be undone by hand.
 * `--diff-filter=ACMR` drops deletions: a file being removed has no content to scan.
 */
export async function stagedFiles(cwd: string): Promise<string[]> {
  const stdout = await git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], cwd);
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Paths whose working-tree content differs from the index, relative to the repository root.
 *
 * `--fix --staged` needs these, and the reason is `git add` rather than the fix itself. That
 * mode writes the working tree and then stages what it wrote, so on a file the developer
 * deliberately left half-staged the staging takes the other half with it, and the commit
 * carries changes nobody chose to commit.
 *
 * No `--diff-filter`: any difference counts. A file staged and then deleted from the working
 * tree differs too, and writing a fix there would put it back.
 */
export async function dirtyFiles(cwd: string): Promise<string[]> {
  const stdout = await git(['diff', '--name-only', '-z'], cwd);
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * The staged content of a path, read from the index rather than the working tree.
 *
 * This is the whole point of the mode. Reading the working tree would report violations
 * the commit does not contain, and a hook that blames you for an unstaged edit is a hook
 * people disable.
 */
export async function stagedContent(root: string, file: string): Promise<string> {
  return (await gitBuffer(['show', `:${file}`], root)).toString('utf8');
}

export async function stageFiles(root: string, files: readonly string[]): Promise<void> {
  if (files.length === 0) return;
  await git(['add', '--', ...files], root);
}

/**
 * `core.commentChar`. `auto` means git picked a character that the message does not
 * already use at the start of a line, so the message itself is the only place to find out
 * which one; the scissors line is the reliable tell.
 */
export async function commentChar(cwd: string, message: string): Promise<string> {
  let configured = '#';
  try {
    configured = (await git(['config', '--get', 'core.commentChar'], cwd)).trim() || '#';
  } catch {
    // Unset is the common case and exits non-zero. The default stands.
  }
  if (configured !== 'auto') return configured;

  const scissors = /^(\S) -{4,} >8 -{4,}$/m.exec(message);
  return scissors?.[1] ?? '#';
}
