#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { prepareCommitMessage } from './commit-msg.js';
import { ConfigNotFoundError, loadConfig } from './config/load.js';
import { toScanOptions, virtualRules } from './config/resolve.js';
import { ConfigError } from './config/schema.js';
import type { LoadedConfig } from './config/types.js';
import { fixFiles } from './fix-files.js';
import { commentChar, repoRoot, stageFiles, stagedContent, stagedFiles } from './git.js';
import { relativeToRoot, toPosix } from './paths.js';
import { readTextFile } from './read.js';
import { scanText } from './scan.js';
import { formatJson } from './report/json.js';
import { formatPretty } from './report/pretty.js';
import { formatSarif } from './report/sarif.js';
import { scan } from './scan-files.js';
import type { Finding } from './types.js';

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
/** Kept distinct so a broken config in CI is never mistaken for a real violation. */
export const EXIT_USAGE = 2;

const FORMATS = ['pretty', 'json', 'sarif'] as const;
type Format = (typeof FORMATS)[number];

const HELP = `charcheck [paths...]

Flags banned characters in targeted parts of a repo, driven by one config.

  paths...              Limit the run to these paths. Each is still filtered
                        through the rules' own include globs, so a path no rule
                        targets is not scanned.

  --config <path>       Use this config instead of searching upward from the
                        working directory.
  --fix                 Rewrite the findings whose rule declares a fix, then
                        report what is left. A fix is a guess about prose, so
                        read the diff.
  --staged              Check the staged content of the staged files, read from
                        the index rather than the working tree, so unstaged
                        edits are never reported. With --fix, the working tree
                        is rewritten and the changed files are staged again.
  --commit-msg <file>   Check a commit message. Comment lines and anything below
                        the scissors are ignored, and a message git generated
                        itself is skipped. --fix is refused here.
  --format <fmt>        pretty (default), json, or sarif. json and sarif go to
                        stdout alone, so piping to a parser needs no filtering.
  --max-warnings <n>    Exit non-zero when warnings exceed n. Unlimited by
                        default.
  --quiet               Report errors only.
  --no-color            Disable colour. NO_COLOR and a non-TTY stdout are
                        already honoured.
  --version, --help

Exit codes: 0 clean, 1 findings, 2 a usage or config error.

Globs in a config resolve against the config file's own directory, so running
from a subdirectory gives identical results.`;

export interface CliIo {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Forces colour on or off. Left unset, detection is picocolors' job. */
  color?: boolean;
}

class UsageError extends Error {}

interface Options {
  paths: string[];
  config?: string;
  commitMsg?: string;
  staged: boolean;
  fix: boolean;
  format: Format;
  maxWarnings?: number;
  quiet: boolean;
  /** undefined leaves picocolors to detect NO_COLOR and a non-TTY stdout itself. */
  color: boolean | undefined;
}

function parse(argv: string[], io: CliIo): Options | 'help' | 'version' {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: 'string' },
        fix: { type: 'boolean', default: false },
        staged: { type: 'boolean', default: false },
        'commit-msg': { type: 'string' },
        format: { type: 'string', default: 'pretty' },
        'max-warnings': { type: 'string' },
        quiet: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false, short: 'h' },
      },
    });
  } catch (cause) {
    throw new UsageError((cause as Error).message);
  }

  const values = parsed.values;
  if (values.help) return 'help';
  if (values.version) return 'version';

  const format = values.format as string;
  if (!FORMATS.includes(format as Format)) {
    throw new UsageError(`unknown format "${format}". Use ${FORMATS.join(', ')}.`);
  }

  let maxWarnings: number | undefined;
  if (values['max-warnings'] !== undefined) {
    maxWarnings = Number(values['max-warnings']);
    if (!Number.isInteger(maxWarnings) || maxWarnings < 0) {
      throw new UsageError('--max-warnings takes a non-negative whole number.');
    }
  }

  const staged = values.staged === true;
  const commitMsg = values['commit-msg'];
  if (commitMsg !== undefined && staged) {
    throw new UsageError('--staged and --commit-msg check different things; use one.');
  }
  if (commitMsg !== undefined && values.fix === true) {
    // Rewriting someone's commit message under them is worse than failing the commit.
    throw new UsageError('--fix is refused for a commit message. Edit the message yourself.');
  }
  if (staged && parsed.positionals.length > 0) {
    throw new UsageError('--staged selects the files itself; do not also pass paths.');
  }

  return {
    paths: parsed.positionals,
    ...(values.config !== undefined ? { config: values.config } : {}),
    ...(commitMsg !== undefined ? { commitMsg } : {}),
    staged,
    fix: values.fix === true,
    format: format as Format,
    ...(maxWarnings !== undefined ? { maxWarnings } : {}),
    quiet: values.quiet === true,
    color: values['no-color'] === true ? false : io.color,
  };
}

async function version(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

/** Only the files that have findings, for the excerpt and caret. */
async function sourcesFor(
  root: string,
  findings: readonly Finding[],
): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (const file of new Set(findings.map((finding) => finding.file))) {
    const outcome = await readTextFile(path.join(root, file));
    if (outcome.ok) sources.set(file, outcome.text);
  }
  return sources;
}

/** The ordinary run: the working tree, optionally narrowed to some paths. */
async function runTree(
  loaded: LoadedConfig,
  options: Options,
  warn: (message: string) => void,
): Promise<ScanOutcome> {
  const scanOptions = {
    ...toScanOptions(loaded, options.paths.length > 0 ? { files: options.paths } : {}),
    onWarning: warn,
  };

  let findings = await scan(scanOptions);
  let fixedCount = 0;

  if (options.fix && findings.some((finding) => finding.fixable)) {
    const outcome = await fixFiles(scanOptions.root, findings, warn);
    fixedCount = outcome.fixed;
    if (outcome.files.length > 0) findings = await scan(scanOptions);
  }

  return { findings, sources: await sourcesFor(scanOptions.root, findings), fixedCount };
}

interface ScanOutcome {
  findings: Finding[];
  sources: Map<string, string>;
  fixedCount: number;
}

/**
 * A commit message, with everything git wrote into the file blanked out first: comment
 * lines, and under `commit.verbose` the whole diff below the scissors. The blanking keeps
 * the character count, so a reported position still points at the line as the developer
 * sees it.
 */
async function runCommitMsg(
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
  const findings = await scanText(prepared.masked, display, rules, {
    assumeText: true,
    ...(loaded.config.markup?.textAttributes
      ? { textAttributes: loaded.config.markup.textAttributes }
      : {}),
  });

  // The excerpt comes from the original, not the blanked copy.
  return { findings, sources: new Map([[display, outcome.text]]), fixedCount: 0 };
}

/**
 * The staged content of the staged files, read from the index.
 *
 * The working tree is deliberately not consulted: a hook that reports a violation the
 * commit does not contain is a hook people turn off.
 */
async function runStaged(
  loaded: LoadedConfig,
  options: Options,
  io: CliIo,
  warn: (message: string) => void,
): Promise<ScanOutcome> {
  const root = await repoRoot(io.cwd);
  const configRoot = loaded.root;

  // Git speaks in repository-relative paths; the rules' globs are relative to the config.
  const toConfigPath = (file: string): string =>
    relativeToRoot(configRoot, path.resolve(root, file));
  const toRepoPath = (file: string): string =>
    toPosix(path.relative(root, path.resolve(configRoot, file)));

  const staged = await stagedFiles(io.cwd);
  if (staged.length === 0) return { findings: [], sources: new Map(), fixedCount: 0 };

  const scanOptions = {
    ...toScanOptions(loaded, { files: staged.map(toConfigPath) }),
    onWarning: warn,
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

  if (options.fix && findings.some((finding) => finding.fixable)) {
    // The working tree is what gets rewritten; the index then has to be brought along, or
    // the commit would still carry the unfixed content.
    const outcome = await fixFiles(configRoot, findings, warn);
    fixedCount = outcome.fixed;
    if (outcome.files.length > 0) {
      await stageFiles(root, outcome.files.map(toRepoPath));
      io.err(`charcheck: re-staged ${String(outcome.files.length)} fixed file(s).`);
      findings = await scan(scanOptions);
    }
  }

  const sources = new Map<string, string>();
  for (const file of new Set(findings.map((finding) => finding.file))) {
    const content = await scanOptions.read(file);
    if (content.ok) sources.set(file, content.text);
  }

  return { findings, sources, fixedCount };
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  let options: Options;
  try {
    const parsed = parse(argv, io);
    if (parsed === 'help') {
      io.out(HELP);
      return EXIT_OK;
    }
    if (parsed === 'version') {
      io.out(await version());
      return EXIT_OK;
    }
    options = parsed;
  } catch (cause) {
    io.err(`charcheck: ${(cause as Error).message}`);
    io.err('Run charcheck --help for usage.');
    return EXIT_USAGE;
  }

  const warn = (message: string): void => {
    io.err(`charcheck: ${message}`);
  };

  let loaded;
  try {
    loaded = await loadConfig({
      from: io.cwd,
      ...(options.config !== undefined ? { configPath: options.config } : {}),
    });
  } catch (cause) {
    if (cause instanceof ConfigError || cause instanceof ConfigNotFoundError) {
      io.err((cause as Error).message);
      return EXIT_USAGE;
    }
    throw cause;
  }

  let outcome: ScanOutcome;
  try {
    if (options.commitMsg !== undefined) {
      // No rule targets a commit message, or git wrote the message itself. Either way
      // there is nothing to check and a hook must not fail.
      const result = await runCommitMsg(loaded, options.commitMsg, io);
      if (result === undefined) return EXIT_OK;
      outcome = result;
    } else if (options.staged) {
      outcome = await runStaged(loaded, options, io, warn);
    } else {
      outcome = await runTree(loaded, options, warn);
    }
  } catch (cause) {
    // A missing optional parser, a bad commit message path, or git refusing: the user's to
    // fix, not a stack trace to read.
    io.err(`charcheck: ${(cause as Error).message}`);
    return EXIT_USAGE;
  }

  const { findings, fixedCount } = outcome;

  const reported = options.quiet
    ? findings.filter((finding) => finding.severity === 'error')
    : findings;

  if (options.format === 'json') {
    io.out(formatJson(reported));
  } else if (options.format === 'sarif') {
    io.out(formatSarif(reported, { toolVersion: await version() }));
  } else {
    io.out(
      formatPretty(reported, {
        color: options.color,
        sources: outcome.sources,
        fixedCount,
      }),
    );
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  if (errors > 0) return EXIT_FINDINGS;
  if (options.maxWarnings !== undefined && warnings > options.maxWarnings) return EXIT_FINDINGS;
  return EXIT_OK;
}

/**
 * Is this module the program being run, rather than an import?
 *
 * Both sides are resolved through `realpath` because a package manager may put a symlink
 * in `node_modules` and node reports the *real* path in `import.meta.url` while argv keeps
 * the link. Comparing them raw makes the binary a silent no-op that exits 0, which is far
 * worse than a crash: every check appears to pass.
 */
function isEntryPoint(): boolean {
  const argv = process.argv[1];
  if (argv === undefined) return false;
  const real = (target: string): string => {
    try {
      return realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  };
  return real(argv) === real(fileURLToPath(import.meta.url));
}

/* c8 ignore start */
if (isEntryPoint()) {
  // process.exitCode, never process.exit: a buffered stdout must be allowed to flush.
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  });
}
/* c8 ignore stop */
