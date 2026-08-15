/**
 * The command line itself: what the flags are, what they mean together, and the help text
 * that describes them. Nothing here reads a file or scans anything.
 */

import { parseArgs } from 'node:util';

const FORMATS = ['pretty', 'json', 'sarif'] as const;
export type Format = (typeof FORMATS)[number];

export const HELP = `charcheck [paths...]

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
                        default. Crossing it is reported on stderr, with the
                        threshold and the distance past it.
  --baseline            Read the baseline file, so only the findings it does not
                        already account for are reported. Already on when the
                        config sets "baseline"; --no-baseline turns it off for
                        one run. The file is the config's "baseline" when that
                        names a path, and charcheck-baseline.json beside the
                        config otherwise. There is no path flag: a path here
                        could not be told apart from a path to scan.
  --baseline-write      Record every finding of this run in the baseline, so a
                        repo that is not at zero can still go green. Refused for
                        a run that saw part of the tree, since the files it did
                        not read would be recorded as clean.
  --baseline-strict     Also fail when the baseline holds an entry whose finding
                        is gone. Off by default: those entries are reported
                        either way, and failing on them turns a pull request
                        that only fixed things red.
  --quiet               List errors only. Warnings are still counted in the
                        summary, and still decide --max-warnings.
  --report-issue        Print a bug report about charcheck itself: the versions
                        in play, and every rule as it resolved, including how
                        many files each one matched. Reads no file and exits 0.
                        Directory names in the globs are replaced, so nothing of
                        your tree goes into the tracker.
  --verbatim            With --report-issue only: keep the real glob names.
  --no-color            Disable colour. NO_COLOR and a non-TTY stdout are
                        already honoured.
  --version, --help

Exit codes: 0 clean, 1 findings, 2 a usage or config error, or a file a rule
targets that no scope could read. A file that was not looked at is reported on
stderr and never counted as a pass.

Globs in a config resolve against the config file's own directory, so running
from a subdirectory gives identical results.`;

export interface CliIo {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Forces colour on or off. Left unset, detection is picocolors' job. */
  color?: boolean;
}

export class UsageError extends Error {}

export interface Options {
  paths: string[];
  config?: string;
  commitMsg?: string;
  staged: boolean;
  fix: boolean;
  format: Format;
  maxWarnings?: number;
  quiet: boolean;
  /**
   * Read the baseline, or ignore it. Left unset the config's own key decides, which is what
   * makes a bare `charcheck` in CI behave the way the repository configured it.
   */
  baseline?: boolean;
  /** Record this run's findings as the baseline. */
  baselineWrite: boolean;
  /** Fail on an entry whose finding is gone, rather than only reporting it. */
  baselineStrict: boolean;
  /** Print the config as it resolved, for a bug report about charcheck itself. */
  reportIssue: boolean;
  /** With `reportIssue`, print the globs as written rather than anonymized. */
  verbatim: boolean;
  /** undefined leaves picocolors to detect NO_COLOR and a non-TTY stdout itself. */
  color: boolean | undefined;
}

export function parse(argv: string[], io: CliIo): Options | 'help' | 'version' {
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
        // A boolean rather than the `--baseline [path]` this wanted to be: node's parser has
        // no optional-argument option, and the space form would take the next word whatever
        // it was, so `charcheck --baseline src` would silently read the baseline from `src`
        // and scan the whole tree. The path belongs in the config, which every run shares.
        baseline: { type: 'boolean', default: false },
        'no-baseline': { type: 'boolean', default: false },
        'baseline-write': { type: 'boolean', default: false },
        'baseline-strict': { type: 'boolean', default: false },
        'report-issue': { type: 'boolean', default: false },
        verbatim: { type: 'boolean', default: false },
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

  const baselineWrite = values['baseline-write'] === true;
  const baselineStrict = values['baseline-strict'] === true;
  const baselineOn = values.baseline === true;
  const baselineOff = values['no-baseline'] === true;
  if (baselineOn && baselineOff) {
    throw new UsageError('--baseline and --no-baseline are opposites; use one.');
  }
  if (baselineOff && (baselineWrite || baselineStrict)) {
    const other = baselineWrite ? '--baseline-write' : '--baseline-strict';
    throw new UsageError(`--no-baseline turns the baseline off, so ${other} cannot apply.`);
  }
  if (commitMsg !== undefined && (baselineOn || baselineOff || baselineWrite || baselineStrict)) {
    // A message is not a file in the tree, so nothing about it can be recorded against one.
    throw new UsageError('a commit message has no baseline; drop the baseline flags.');
  }
  if (baselineWrite && (staged || parsed.positionals.length > 0)) {
    // The write records the whole run as the whole truth. A run that looked at part of the
    // tree would record every file it never opened as having no findings, which reads later
    // as known-good and can never be told from the real thing.
    const partial = staged ? '--staged' : 'a positional path';
    throw new UsageError(
      `--baseline-write records what the run saw, and ${partial} sees part of the tree: ` +
        `the rest would be recorded as clean. Write it from a run over the whole tree.`,
    );
  }

  const reportIssue = values['report-issue'] === true;
  const verbatim = values.verbatim === true;
  if (verbatim && !reportIssue) {
    throw new UsageError('--verbatim only means something alongside --report-issue.');
  }
  if (reportIssue) {
    // Everything else either selects files to read or shapes a report of findings, and this
    // flag does neither. Refused rather than quietly ignored: a flag that appears to have
    // been honoured and was not is this tool's own characteristic failure.
    const conflict = (
      [
        ['--fix', values.fix === true],
        ['--staged', staged],
        ['--commit-msg', commitMsg !== undefined],
        ['--format', format !== 'pretty'],
        ['--max-warnings', maxWarnings !== undefined],
        ['--quiet', values.quiet === true],
        ['--baseline-write', baselineWrite],
        ['--baseline-strict', baselineStrict],
        ['the positional paths', parsed.positionals.length > 0],
      ] as const
    ).find(([, given]) => given);
    if (conflict) {
      throw new UsageError(
        `--report-issue reports the configuration and scans nothing; drop ${conflict[0]}.`,
      );
    }
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
    ...(baselineOn || baselineOff ? { baseline: baselineOn } : {}),
    baselineWrite,
    baselineStrict,
    reportIssue,
    verbatim,
    color: values['no-color'] === true ? false : io.color,
  };
}
