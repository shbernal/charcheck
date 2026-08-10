#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ConfigNotFoundError, loadConfig } from './config/load.js';
import { toScanOptions } from './config/resolve.js';
import { ConfigError } from './config/schema.js';
import { fixFiles } from './fix-files.js';
import { readTextFile } from './read.js';
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

  return {
    paths: parsed.positionals,
    ...(values.config !== undefined ? { config: values.config } : {}),
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

  const scanOptions = {
    ...toScanOptions(loaded, options.paths.length > 0 ? { files: options.paths } : {}),
    onWarning: warn,
  };

  let findings: Finding[];
  try {
    findings = await scan(scanOptions);
  } catch (cause) {
    // A missing optional parser is the user's problem to fix, not a crash to report.
    io.err(`charcheck: ${(cause as Error).message}`);
    return EXIT_USAGE;
  }

  let fixedCount = 0;
  if (options.fix && findings.some((finding) => finding.fixable)) {
    const outcome = await fixFiles(scanOptions.root, findings, warn);
    fixedCount = outcome.fixed;
    if (outcome.files.length > 0) findings = await scan(scanOptions);
  }

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
        sources: await sourcesFor(scanOptions.root, reported),
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

/* c8 ignore start */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  // process.exitCode, never process.exit: a buffered stdout must be allowed to flush.
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  });
}
/* c8 ignore stop */
