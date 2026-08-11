import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { fileRules } from '../config/resolve.js';
import type { LoadedConfig } from '../config/types.js';
import { DEFAULT_IGNORE, filesForRule } from '../scan-files.js';
import type { Rule, Scope } from '../types.js';
import { createGlobAnonymizer } from './anonymize.js';

/**
 * The body of a bug report about charcheck itself, ready for `gh issue create --body-file`.
 *
 * It exists for one section, "the rule, as resolved". Every other fact here can be pasted by
 * hand; that one cannot, because a pasted config hides the two things that explain nearly
 * every report, which are what the globs actually reached and which rules reached nothing at
 * all. The human sections are left as placeholders in the same order the issue form asks for
 * them, so the three shapes that describe a charcheck report stay one shape.
 */

/** Which optional peer each scope needs, so a report names the versions that were in play. */
const SCOPE_PEERS: Record<Scope, readonly string[]> = {
  raw: [],
  strings: ['typescript'],
  markup: ['typescript', '@vue/compiler-sfc'],
  markdown: ['micromark'],
  html: ['parse5'],
};

/**
 * `\uXXXX` for anything outside printable ASCII.
 *
 * The report is about characters that do not survive a copy and paste: a zero width space is
 * eaten by clipboards, browsers and issue forms alike, so a rule that listed the character
 * itself would frequently name a different one by the time a maintainer read it. Writing the
 * escape is a fidelity requirement rather than a courtesy, and it is what this same report
 * asks the reporter to do for the reproduction.
 */
function escapeUnicode(value: string): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    escaped +=
      code >= 0x20 && code <= 0x7e ? value[index] : `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return escaped;
}

async function readManifest(
  file: string,
): Promise<{ name?: string; version?: string } | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as { name?: string; version?: string };
  } catch {
    return undefined;
  }
}

/**
 * The version of an optional peer as this project resolves it, or undefined when it is not
 * installed.
 *
 * Resolution starts from the config's own directory rather than from charcheck's, because
 * the copy that matters is the one the rules would have used.
 */
async function peerVersion(from: string, name: string): Promise<string | undefined> {
  const require = createRequire(path.join(from, 'package.json'));

  try {
    return (await readManifest(require.resolve(`${name}/package.json`)))?.version;
  } catch {
    // A package whose "exports" does not list its own manifest resolves only to its entry
    // point. TypeScript is one, and TypeScript is the peer most reports will name.
  }

  let directory;
  try {
    directory = path.dirname(require.resolve(name));
  } catch {
    return undefined;
  }
  for (;;) {
    const manifest = await readManifest(path.join(directory, 'package.json'));
    if (manifest?.name === name) return manifest.version;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function peersFor(rules: readonly Rule[]): string[] {
  const needed = new Set<string>();
  for (const rule of rules) {
    for (const peer of SCOPE_PEERS[rule.scope ?? 'raw']) needed.add(peer);
  }
  return [...needed].sort();
}

/**
 * A glob list, anonymized unless the reporter asked for the real thing.
 *
 * An empty list reads as `none`, the same as an absent key, because the two behave the same
 * and the report is a document read for anomalies: a key printed with nothing after it is the
 * shape of a value that failed to serialize, which is a false lead. An empty `exclude` is not
 * even unusual, being the starting state of a list a config adds paths to over time.
 */
function patterns(values: readonly string[], anonymize: (pattern: string) => string): string {
  if (values.length === 0) return 'none';
  return values.map((value) => `\`${anonymize(value)}\``).join(', ');
}

function chars(rule: Rule): string {
  if (rule.pattern !== undefined) return `- pattern: \`${escapeUnicode(rule.pattern)}\``;
  return `- chars: ${(rule.chars ?? []).map((char) => `\`${escapeUnicode(char)}\``).join(', ')}`;
}

async function describeRule(
  rule: Rule,
  index: number,
  loaded: LoadedConfig,
  ignore: readonly string[],
  anonymize: (pattern: string) => string,
): Promise<string> {
  // Rules are named by position, never by id. An id is local to whoever wrote the config and
  // means nothing in an issue somebody else reads, and the reporter maps a number back by
  // counting. `message` is dropped rather than anonymized: it never affects what is matched,
  // so it is the one field that is pure prose with no diagnostic value.
  const lines = [
    `#### rule ${String(index + 1)}`,
    '',
    `- scope: \`${rule.scope ?? 'raw'}\``,
    chars(rule),
    `- severity: \`${rule.severity ?? 'error'}\``,
    `- fix: ${rule.fix === undefined ? 'none' : typeof rule.fix === 'function' ? 'a function' : 'a replacement string'}`,
    `- include: ${patterns(rule.include, anonymize)}`,
    `- exclude: ${patterns(rule.exclude ?? [], anonymize)}`,
  ];

  // A rule that targets only a virtual surface never touches a glob, so a file count for it
  // would be a zero that means nothing, which is exactly the number that reads as the bug.
  const [scannable] = fileRules([rule]);
  if (scannable === undefined) {
    lines.push('- matched: not a file rule, so no glob was resolved');
  } else {
    const matched = await filesForRule(loaded.root, scannable, ignore);
    lines.push(`- matched: ${String(matched.length)} file(s)`);
  }

  return lines.join('\n');
}

export interface IssueReportOptions {
  loaded: LoadedConfig;
  /** The running charcheck version. */
  version: string;
  /** Print the real glob names. Never the default: see `anonymize.ts`. */
  verbatim?: boolean;
}

const ANONYMIZED_NOTE = `Directory and file names in the globs below are placeholders, numbered in order of first
appearance and shared between rules, so two rules that name the same directory still look
alike. Everything that decides what a pattern matches is verbatim: a double star against a
single one, the segment count, brace expansions, the extension, and the leading dot on a
dotted directory. The shape is the diagnostic and the real names are not needed, so there is
no need to ask for them.`;

const VERBATIM_NOTE = `Globs are printed as written, because this report was produced with \`--verbatim\`.`;

/**
 * The placeholders, worded as the issue form words them. Left for the reporter to fill in,
 * and deliberately not prompted for interactively: the command has to work unattended.
 */
const PLACEHOLDERS = `### The command you ran

<the charcheck invocation, with its flags>

### What happened

<for a silent miss: it exited 0 and reported nothing>

### What should have happened

<and why: the scope's documented contract, or the fact that limitations.md does not state
this one>

### Minimal reproduction

<a config and one input file, both synthesized rather than copied, with every banned
character written as a \\uXXXX escape so that it survives the trip>

### Full output

<verbatim, stdout and stderr, with the exit code>

### Triage

<which steps of the charcheck-upstream skill's section 1 were checked, and how they were
ruled out>`;

export async function formatIssueReport(options: IssueReportOptions): Promise<string> {
  const { loaded, version } = options;
  const rules = loaded.config.rules;
  const ignore = [...DEFAULT_IGNORE, ...(loaded.config.ignore ?? [])];

  // Identity when the reporter opted out, which is the only way a real name reaches the
  // output. It is still one renamer for the whole report either way.
  const anonymize =
    options.verbatim === true ? (pattern: string): string => pattern : createGlobAnonymizer();

  const peers = peersFor(rules);
  const versions = await Promise.all(peers.map((peer) => peerVersion(loaded.root, peer)));
  const peerLines =
    peers.length === 0
      ? 'No rule uses a scope with a peer dependency.'
      : peers
          .map((peer, index) => `- \`${peer}\`: ${versions[index] ?? 'not installed'}`)
          .join('\n');

  const resolved = await Promise.all(
    rules.map((rule, index) => describeRule(rule, index, loaded, ignore, anonymize)),
  );

  return [
    "_Generated by `charcheck --report-issue`. The bracketed sections are the reporter's to fill in._",
    '### charcheck version',
    version,
    '### Node version',
    process.version,
    '### Operating system',
    `${process.platform} ${os.release()} (${process.arch})`,
    '### Peer versions',
    peerLines,
    '### The rule, as resolved',
    // The config is named by its basename alone, and the directory it resolved against is
    // reported as the working directory. Both are paths, and a path is a name.
    `Read from \`${path.basename(loaded.filepath)}\`, with every glob resolved against the ` +
      `directory holding that file.`,
    options.verbatim === true ? VERBATIM_NOTE : ANONYMIZED_NOTE,
    ...resolved,
    PLACEHOLDERS,
  ].join('\n\n');
}
