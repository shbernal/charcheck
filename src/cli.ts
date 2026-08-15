#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BaselineError } from './baseline.js';
import { applyBaseline, baselineUse } from './cli/baseline.js';
import { HELP, parse } from './cli/options.js';
import type { CliIo, Options } from './cli/options.js';
import { runCommitMsg, runStaged, runTree } from './cli/modes.js';
import type { ScanOutcome } from './cli/modes.js';
import { ConfigNotFoundError, loadConfig } from './config/load.js';
import { ConfigError } from './config/schema.js';
import { formatIssueReport } from './report/issue.js';
import { formatJson } from './report/json.js';
import { formatPretty, plural } from './report/pretty.js';
import { formatSarif } from './report/sarif.js';

export type { CliIo } from './cli/options.js';

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
/** Kept distinct so a broken config in CI is never mistaken for a real violation. */
export const EXIT_USAGE = 2;

async function version(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
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

  // A file a rule targets and no scope can read. The scan keeps going, so the report still
  // covers everything else, but the run cannot be called clean: the answer for that file is
  // not "no findings", it is "not looked at".
  const skipped: string[] = [];
  const skip = (file: string, error: Error): void => {
    skipped.push(file);
    warn(error.message);
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

  if (options.reportIssue) {
    // A diagnostic, not a check: it resolves the globs to count what each rule reaches, reads
    // no file, and exits 0 whatever the tree holds.
    io.out(
      await formatIssueReport({
        loaded,
        version: await version(),
        verbatim: options.verbatim,
      }),
    );
    return EXIT_OK;
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
      outcome = await runStaged(loaded, options, io, warn, skip);
    } else {
      outcome = await runTree(loaded, options, warn, skip);
    }
  } catch (cause) {
    // A missing optional parser, a bad commit message path, or git refusing: the user's to
    // fix, not a stack trace to read.
    io.err(`charcheck: ${(cause as Error).message}`);
    return EXIT_USAGE;
  }

  const { fixedCount } = outcome;
  let findings = outcome.findings;
  let baselined = 0;
  let stale = 0;
  let staleFails = false;

  const use = baselineUse(loaded, options);
  if (use !== undefined) {
    if (use.write && skipped.length > 0) {
      // The write records what the run saw as all there is. A file that could not be read
      // has no findings, and recording that as zero says known-good in a way no later run
      // can tell from the real thing.
      warn(
        `refusing to write the baseline: ${plural(skipped.length, 'file')} could not be ` +
          `scanned, and would be recorded as having nothing wrong.`,
      );
      return EXIT_USAGE;
    }
    try {
      const report = await applyBaseline(use, outcome);
      findings = report.reported;
      baselined = report.accounted;
      stale = report.stale.length;
      staleFails = use.strict && stale > 0;

      const where = path.relative(io.cwd, use.filepath) || use.filepath;
      if (report.written) warn(`recorded ${plural(baselined, 'finding')} in ${where}.`);
      else if (report.missing) warn(`no baseline at ${where}, so every finding is new.`);
      if (report.pruned) {
        const dropped = report.pruned.dropped;
        const entries = `${String(dropped)} ${dropped === 1 ? 'entry' : 'entries'}`;
        // Not staged under --staged: a hook that added a file to the commit on its own is
        // worse than one that says what it changed.
        warn(
          dropped > 0
            ? `dropped ${entries} from ${where} that the fixes removed. Commit the file.`
            : `refreshed ${where} after the fixes. Commit the file.`,
        );
      }
      if (report.pruneRefused) warn(`left ${where} alone: ${report.pruneRefused}`);
      if (stale > 0) {
        const entries = stale === 1 ? '1 baseline entry' : `${String(stale)} baseline entries`;
        warn(
          `${entries} in ${where} no longer match a finding` +
            (use.strict
              ? ', and --baseline-strict fails on that.'
              : '. Write the baseline again to drop them.'),
        );
      }
    } catch (cause) {
      // A baseline that exists and cannot be used is a configuration problem, not a clean
      // run: degrading to an empty one would report every recorded finding as new.
      if (cause instanceof BaselineError) {
        io.err(`charcheck: ${cause.message}`);
        return EXIT_USAGE;
      }
      throw cause;
    }
  }

  // Every formatter is handed the whole run and narrows the list itself, so what --quiet
  // hides is still counted. A summary that agreed with the listing rather than with the
  // exit code left a failing run saying nothing was wrong.
  const quiet = options.quiet;
  if (options.format === 'json') {
    io.out(formatJson(findings, { quiet }));
  } else if (options.format === 'sarif') {
    io.out(formatSarif(findings, { toolVersion: await version(), quiet }));
  } else {
    io.out(
      formatPretty(findings, {
        color: options.color,
        sources: outcome.sources,
        fixedCount,
        quiet,
        baselined,
      }),
    );
  }
  if (baselined > 0 && options.format !== 'pretty') {
    // json and sarif own stdout, so the one line that explains why the list is shorter than
    // the tree goes to stderr rather than being left unsaid.
    warn(`${plural(baselined, 'finding')} accounted for by the baseline.`);
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  if (errors > 0) return EXIT_FINDINGS;
  if (options.maxWarnings !== undefined && warnings > options.maxWarnings) {
    // On stderr, and said in full: the threshold and the distance past it. Nothing else in
    // the report explains this exit code, and under --quiet or --format json nothing else
    // may be added to stdout.
    const over = warnings - options.maxWarnings;
    warn(
      `${plural(warnings, 'warning')}, ${String(over)} over the --max-warnings limit of ${String(options.maxWarnings)}.`,
    );
    return EXIT_FINDINGS;
  }
  if (staleFails) return EXIT_FINDINGS;
  if (skipped.length > 0) {
    // Reported after the findings, so the list is the last thing on the screen.
    warn(`${String(skipped.length)} file(s) could not be scanned. This run is not a pass.`);
    return EXIT_USAGE;
  }
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

if (isEntryPoint()) {
  // process.exitCode, never process.exit: a buffered stdout must be allowed to flush.
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  });
}
