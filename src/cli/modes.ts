/**
 * The three things a run can be: the working tree, the git index, or a commit message.
 *
 * Each returns the same outcome, so the reporting above them is written once and none of it
 * knows where the text came from.
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';

import type { BaselineScope } from '../baseline.js';
import { prepareCommitMessage } from '../commit-msg.js';
import { textAttributesOf, toScanOptions, virtualRules } from '../config/resolve.js';
import type { LoadedConfig } from '../config/types.js';
import { fixToFixpoint, isFixable } from '../fix-files.js';
import { commentChar, repoRoot, stageFiles, stagedContent, stagedFiles } from '../git.js';
import { relativeToRoot, toPosix } from '../paths.js';
import { readTextFile } from '../read.js';
import type { ReadOutcome } from '../read.js';
import { scan } from '../scan-files.js';
import { scanText } from '../scan.js';
import type { Finding } from '../types.js';
import { UsageError } from './options.js';
import type { CliIo, Options } from './options.js';

export interface ScanOutcome {
  findings: Finding[];
  sources: Map<string, string>;
  fixedCount: number;
  /**
   * False when `--fix` ran out of passes with fixable findings still standing, which means
   * two rules are rewriting each other and what is on disk is neither one's idea of right.
   * The run cannot be called clean whatever the remaining findings say, so this is carried
   * up rather than left to the exit code the findings happen to produce.
   */
  converged: boolean;
  /**
   * Which files this run was allowed to look at, for stale baseline entries. Only a run
   * that could have seen a file can say its finding is gone. `scan()` does not report the
   * files it read, and asking it to would mean a callback on the frozen `ScanOptions`; the
   * restriction each mode passed answers the same question and is already in hand.
   */
  scope: BaselineScope;
}

/**
 * Only the files that have findings, for the excerpt and caret.
 *
 * The reader is a parameter because a staged run must not read the working tree here either:
 * an excerpt taken from disk would print a line the commit does not contain, under a caret
 * pointing at a column computed from the indexed content.
 */
async function sourcesFor(
  findings: readonly Finding[],
  read: (file: string) => Promise<ReadOutcome>,
): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (const file of new Set(findings.map((finding) => finding.file))) {
    const outcome = await read(file);
    if (outcome.ok) sources.set(file, outcome.text);
  }
  return sources;
}

/** The ordinary run: the working tree, optionally narrowed to some paths. */
export async function runTree(
  loaded: LoadedConfig,
  options: Options,
  warn: (message: string) => void,
  skip: (file: string, error: Error) => void,
): Promise<ScanOutcome> {
  const scanOptions = {
    ...toScanOptions(loaded, options.paths.length > 0 ? { files: options.paths } : {}),
    onWarning: warn,
    onSkipped: skip,
  };

  let findings = await scan(scanOptions);
  let fixedCount = 0;
  let converged = true;

  if (options.fix && findings.some(isFixable)) {
    const outcome = await fixToFixpoint(
      scanOptions.root,
      findings,
      async () => scan(scanOptions),
      warn,
    );
    findings = outcome.findings;
    fixedCount = outcome.fixed;
    converged = outcome.converged;
  }

  const sources = await sourcesFor(findings, (file) =>
    readTextFile(path.join(scanOptions.root, file)),
  );
  // Spelled through `relativeToRoot` exactly as the scan spells its own restriction, or the
  // two spellings of one path never compare equal and every entry reads as out of scope. A
  // positional directory names no file and so matches no entry, which under-reports stale
  // rather than inventing one.
  const scope: BaselineScope =
    options.paths.length > 0
      ? {
          kind: 'files',
          files: new Set(options.paths.map((file) => relativeToRoot(scanOptions.root, file))),
        }
      : { kind: 'all' };
  return { findings, sources, fixedCount, converged, scope };
}

/**
 * A commit message, with everything git wrote into the file blanked out first: comment
 * lines, and under `commit.verbose` the whole diff below the scissors. The blanking keeps
 * the character count, so a reported position still points at the line as the developer
 * sees it.
 */
export async function runCommitMsg(
  loaded: LoadedConfig,
  file: string,
  io: CliIo,
): Promise<ScanOutcome | undefined> {
  const rules = virtualRules(loaded.config.rules, 'commit-msg');
  if (rules.length === 0) return undefined;

  const outcome = await readTextFile(path.resolve(io.cwd, file));
  if (!outcome.ok) {
    throw new UsageError(`cannot read the commit message at ${file}: ${outcome.reason}`);
  }

  const comment = await commentChar(io.cwd, outcome.text);
  const prepared = prepareCommitMessage(outcome.text, comment);
  if (prepared.generated) return undefined;

  const display = toPosix(file);
  const textAttributes = textAttributesOf(loaded.config);
  const findings = await scanText(prepared.masked, display, rules, {
    assumeText: true,
    ...(textAttributes ? { textAttributes } : {}),
  });

  // The excerpt comes from the original, not the blanked copy.
  return {
    findings,
    sources: new Map([[display, outcome.text]]),
    fixedCount: 0,
    // `--fix` is refused with `--commit-msg`, so nothing here can fail to settle.
    converged: true,
    // No file in the tree was read, and a message is not baselined in any case.
    scope: { kind: 'files', files: new Set() },
  };
}

/**
 * A directory as the filesystem itself spells it: links resolved, and on Windows the real
 * name rather than an 8.3 alias.
 *
 * The two roots below must agree character for character, because one is subtracted from
 * the other to turn a repository-relative path into a config-relative one. Git reports the
 * resolved path from `rev-parse`, while the config root comes from wherever the process
 * started, and the two disagree the moment the repository is reached through a link:
 * `/var` against `/private/var` on macOS, `RUNNER~1` against the real user name on
 * Windows. Left alone the subtraction yields `../../…`, which matches no glob, so every
 * staged file is filtered out and the hook reports a clean commit however dirty it is.
 *
 * `.native` rather than `realpathSync`, because the JavaScript implementation resolves
 * symlinks but leaves an 8.3 alias exactly as it found it, which fixes macOS and leaves
 * Windows broken in precisely the same silent way.
 */
function canonical(target: string): string {
  try {
    return toPosix(realpathSync.native(target));
  } catch {
    return toPosix(path.resolve(target));
  }
}

/**
 * The staged content of the staged files, read from the index.
 *
 * The working tree is deliberately not consulted: a hook that reports a violation the
 * commit does not contain is a hook people turn off.
 */
export async function runStaged(
  loaded: LoadedConfig,
  options: Options,
  io: CliIo,
  warn: (message: string) => void,
  skip: (file: string, error: Error) => void,
): Promise<ScanOutcome> {
  const root = canonical(await repoRoot(io.cwd));
  const configRoot = canonical(loaded.root);

  // Git speaks in repository-relative paths; the rules' globs are relative to the config.
  const toConfigPath = (file: string): string =>
    relativeToRoot(configRoot, path.resolve(root, file));
  const toRepoPath = (file: string): string =>
    toPosix(path.relative(root, path.resolve(configRoot, file)));

  const staged = await stagedFiles(io.cwd);
  const scope: BaselineScope = { kind: 'files', files: new Set(staged.map(toConfigPath)) };
  if (staged.length === 0) {
    return { findings: [], sources: new Map(), fixedCount: 0, converged: true, scope };
  }

  const scanOptions = {
    ...toScanOptions(loaded, { files: staged.map(toConfigPath) }),
    onWarning: warn,
    onSkipped: skip,
    read: async (file: string) => {
      try {
        return { ok: true as const, text: await stagedContent(root, toRepoPath(file)) };
      } catch (cause) {
        return { ok: false as const, missing: false, reason: (cause as Error).message };
      }
    },
  };

  let findings = await scan(scanOptions);
  let fixedCount = 0;
  let converged = true;

  if (options.fix && findings.some(isFixable)) {
    // The working tree is what gets rewritten; the index then has to be brought along, or
    // the commit would still carry the unfixed content. Staged after every pass rather than
    // once at the end, because the next pass scans the index: an unstaged fix would be read
    // as never having happened, and the pass would compute the same finding again.
    const outcome = await fixToFixpoint(
      configRoot,
      findings,
      async () => scan(scanOptions),
      warn,
      async (files) => stageFiles(root, files.map(toRepoPath)),
    );
    findings = outcome.findings;
    fixedCount = outcome.fixed;
    converged = outcome.converged;
    if (outcome.files.length > 0) {
      // Once, naming the files rather than the writes: a file rewritten by three passes was
      // staged three times and is still one file in the commit.
      io.err(`charcheck: re-staged ${String(outcome.files.length)} fixed file(s).`);
    }
  }

  return {
    findings,
    sources: await sourcesFor(findings, scanOptions.read),
    fixedCount,
    converged,
    scope,
  };
}
