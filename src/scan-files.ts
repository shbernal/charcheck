import path from 'node:path';

import { glob } from 'tinyglobby';

import { byPosition } from './order.js';
import { restrictionPath } from './paths.js';
import { readTextFile } from './read.js';
import type { ReadOutcome } from './read.js';
import { scanText } from './scan.js';
import { scopeSupportsFile } from './scope/index.js';
import { JsxUnsupportedError } from './scope/missing-peer.js';
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
   * Restrict the scan to these paths, absolute or relative to `root`. A path may name a
   * file or a directory, and a directory selects everything below it. Each is still
   * filtered through the rules' globs, so a path outside every rule's `include` is not
   * scanned. This is what a staged-files run passes.
   */
  files?: readonly string[];
  /** Added to every rule's own `exclude`. */
  ignore?: readonly string[];
  /** How many files to read at once. */
  concurrency?: number;
  /**
   * Called for a file that could not be read, and for a rule whose globs matched nothing.
   * A run continues regardless.
   */
  onWarning?: (message: string) => void;
  /**
   * Called for an entry of `files` that no rule's globs reached, so it contributed nothing
   * to the scan. Left to the caller to phrase, because whether that is worth saying depends
   * on where the path came from: a person typed it and means it, while a staged set is
   * whatever the commit happened to touch and is mostly not any rule's business.
   */
  onUnmatchedPath?: (file: string) => void;
  /**
   * Called for a file a rule targets and no scope can read, which today means JSX on a
   * TypeScript that ships only a scanner. The scan continues over every other file, so one
   * unreadable file cannot suppress the whole report, but a caller that ignores this is
   * calling a partial scan a clean one. The CLI fails the run.
   */
  onSkipped?: (file: string, error: Error) => void;
  /**
   * Called for a finding a suppression marker silenced, which is never returned. A caller
   * that ignores this cannot tell a run that found nothing from one that was told to say
   * nothing, and those are the two runs a suppression sits between.
   */
  onSuppressed?: (finding: Finding) => void;
  /**
   * Supplies a file's content instead of the filesystem, given its root-relative path.
   * A staged run uses this to read the git index rather than the working tree.
   */
  read?: (file: string) => Promise<ReadOutcome>;
}

/**
 * The files one rule reaches, before any narrowing by `files`.
 *
 * Exported because `--report-issue` needs the count and nothing else: how many files a rule
 * matched is the fact that explains most silent misses, and getting it costs the glob pass
 * alone, with no file read.
 */
export async function filesForRule(
  root: string,
  rule: Rule,
  ignore: readonly string[] = [],
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

  // A path may name a directory, which is no file's own path, so the test is equality or a
  // prefix at a segment boundary: `src` selects `src/a.ts` and never `srcery/a.ts`. Decided
  // from the string alone, with no stat: a `--staged` run passes paths that may already be
  // gone from the working tree, and a filesystem probe would make what a hook scans depend
  // on the tree it happens to run against.
  const restriction = options.files?.map((file) => restrictionPath(root, file));
  const reached = new Set<string>();
  const entriesFor = (file: string): string[] =>
    restriction === undefined
      ? []
      : restriction.filter((entry) => file === entry || file.startsWith(`${entry}/`));

  const plan = new Map<string, Rule[]>();
  const matched = await Promise.all(rules.map((rule) => filesForRule(root, rule, ignore)));

  for (const [index, files] of matched.entries()) {
    const rule = rules[index]!;

    // A rule that reaches nothing is the failure this tool is least able to show you:
    // its output is a clean run. Reported before the `files` restriction is applied,
    // because under `--staged` a rule matching nothing staged is the normal case and
    // says nothing about the globs.
    if (files.length === 0) {
      options.onWarning?.(
        `rule "${rule.id}" matched no files: ${rule.include.join(', ')}. Check the globs; ` +
          `a dotted directory is only entered when a pattern names it.`,
      );
    }

    // The same silent failure as a rule that reaches nothing, arrived at one step later: the
    // globs found files and the scope cannot read a single one of them, so every one is
    // extracted as empty and the run reports clean over a set it never read.
    //
    // Config load rejects a pattern that names an unreadable extension outright, which is the
    // decidable half. A directory glob states no intent about extensions and is left alone
    // there, and is left alone here too unless it turns out to have matched nothing readable:
    // `docs/**` under `markdown` beside one `.png` is what people mean, and warning about it
    // would make the check unusable. None readable is not a ratio to judge, it is the whole
    // rule doing nothing.
    //
    // Counted before the `files` restriction, exactly as the warning above is, or every
    // `--staged` run whose commit happened to touch no readable file would say this.
    const scope = rule.scope ?? 'raw';
    if (files.length > 0 && files.every((file) => !scopeSupportsFile(scope, file))) {
      options.onWarning?.(
        `rule "${rule.id}" uses scope "${scope}", which can read none of the ` +
          `${String(files.length)} file(s) it matched: ${rule.include.join(', ')}. Such a file ` +
          `is scanned as empty and reported as clean, so this rule checked nothing. Give it a ` +
          `scope that reads these files, or point it at files this scope can read.`,
      );
    }

    for (const file of files) {
      if (restriction) {
        const hits = entriesFor(file);
        if (hits.length === 0) continue;
        for (const entry of hits) reached.add(entry);
      }
      const existing = plan.get(file);
      if (existing) existing.push(rule);
      else plan.set(file, [rule]);
    }
  }

  // A path is intersected with the rules' globs, never substituted for them, so one that no
  // rule targets scans nothing and the run reports clean over it. Reported once per entry,
  // however many times it was passed, and before a single file is read.
  for (const entry of new Set(restriction)) {
    if (!reached.has(entry)) options.onUnmatchedPath?.(entry);
  }

  return plan;
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
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
    const outcome = options.read
      ? await options.read(file)
      : await readTextFile(path.join(options.root, file));
    if (!outcome.ok) {
      if (!outcome.missing) options.onWarning?.(`cannot read ${file}: ${outcome.reason}`);
      return [];
    }
    try {
      return await scanText(outcome.text, file, rules, {
        textAttributes: options.textAttributes,
        ...(options.onSuppressed ? { onSuppressed: options.onSuppressed } : {}),
      });
    } catch (cause) {
      // One file no scope can read must not take the report down with it: the findings
      // already collected from every other file are the whole point of the run. Anything
      // else is a real failure and is left to propagate.
      if (cause instanceof JsxUnsupportedError) {
        options.onSkipped?.(file, cause);
        return [];
      }
      throw cause;
    }
  });

  return perFile.flat().sort(byPosition);
}
