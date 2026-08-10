import path from 'node:path';

import { glob } from 'tinyglobby';

import { relativeToRoot } from './paths.js';
import { readTextFile } from './read.js';
import { scanText } from './scan.js';
import type { ExtractorOptions, Finding, Rule } from './types.js';

/**
 * Directories nobody means to scan. A rule can still reach into one by naming it in
 * `include`, but no rule should have to remember to exclude them.
 */
export const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**'];

export interface ScanOptions extends ExtractorOptions {
  /** Directory the rules' globs are resolved against. Required: no cwd is assumed. */
  root: string;
  rules: readonly Rule[];
  /**
   * Restrict the scan to these paths, absolute or relative to `root`. Each is still
   * filtered through the rules' globs, so a path outside every rule's `include` is not
   * scanned. This is what a staged-files run passes.
   */
  files?: readonly string[];
  /** Added to every rule's own `exclude`. */
  ignore?: readonly string[];
  /** How many files to read at once. */
  concurrency?: number;
  /** Called for a file that could not be read. A run over a tree continues regardless. */
  onWarning?: (message: string) => void;
}

async function filesForRule(
  root: string,
  rule: Rule,
  ignore: readonly string[],
): Promise<string[]> {
  return glob({
    patterns: [...rule.include],
    cwd: root,
    ignore: [...ignore, ...(rule.exclude ?? [])],
    onlyFiles: true,
    absolute: false,
    // A dotted directory is scanned only when a pattern names it. Nobody expects
    // `docs/**` to walk into `.github`.
    dot: false,
    expandDirectories: false,
  });
}

/**
 * Which rules apply to which files. Built by globbing per rule and inverting, so a file
 * matched by three rules is still read exactly once.
 */
async function planScan(options: ScanOptions): Promise<Map<string, Rule[]>> {
  const { root, rules } = options;
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

  const restriction =
    options.files === undefined
      ? undefined
      : new Set(options.files.map((file) => relativeToRoot(root, file)));

  const plan = new Map<string, Rule[]>();
  const matched = await Promise.all(rules.map((rule) => filesForRule(root, rule, ignore)));

  for (const [index, files] of matched.entries()) {
    const rule = rules[index]!;
    for (const file of files) {
      if (restriction && !restriction.has(file)) continue;
      const existing = plan.get(file);
      if (existing) existing.push(rule);
      else plan.set(file, [rule]);
    }
  }

  return plan;
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Scan a tree, or a set of paths within one.
 *
 * The library half of the tool: it returns findings and nothing else. No output, no
 * colour, no exit code. Those belong to the CLI, which is just another caller of this.
 */
export async function scan(options: ScanOptions): Promise<Finding[]> {
  const plan = await planScan(options);
  const entries = [...plan.entries()];

  const perFile = await mapWithLimit(entries, options.concurrency ?? 16, async ([file, rules]) => {
    const outcome = await readTextFile(path.join(options.root, file));
    if (!outcome.ok) {
      if (!outcome.missing) options.onWarning?.(`cannot read ${file}: ${outcome.reason}`);
      return [];
    }
    return scanText(outcome.text, file, rules, { textAttributes: options.textAttributes });
  });

  return perFile
    .flat()
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.offset - b.offset));
}
