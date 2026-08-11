import { scan } from '../scan-files.js';
import type { ScanOptions } from '../scan-files.js';
import type { Finding, Rule } from '../types.js';
import { VIRTUAL_PATTERN } from './schema.js';
import type { CharcheckConfig, LoadedConfig } from './types.js';

/**
 * Rules targeting a real file, with any virtual pattern removed. A rule that targets only
 * a virtual surface, such as a commit message, is not part of a file scan at all.
 */
export function fileRules(rules: readonly Rule[]): Rule[] {
  const result: Rule[] = [];
  for (const rule of rules) {
    const include = rule.include.filter((pattern) => !VIRTUAL_PATTERN.test(pattern));
    if (include.length === 0) continue;
    result.push(include.length === rule.include.length ? rule : { ...rule, include });
  }
  return result;
}

/** Rules that target a named virtual surface, such as `<commit-msg>`. */
export function virtualRules(rules: readonly Rule[], target: string): Rule[] {
  const pattern = `<${target}>`;
  return rules.filter((rule) => rule.include.includes(pattern));
}

/**
 * The attribute allowlist, from either spelling. `markup.textAttributes` came first, when
 * `markup` was the only scope that read attributes; `html` reads the same list, so the key
 * moved up. The schema rejects a config that sets both.
 */
export function textAttributesOf(config: CharcheckConfig): string[] | undefined {
  return config.textAttributes ?? config.markup?.textAttributes;
}

export interface ResolveOptions {
  /** Restrict to these paths. Still intersected with each rule's globs. */
  files?: readonly string[];
  /** Overrides the config's directory. The CLI has no reason to use this. */
  root?: string;
}

/**
 * Config to scan options. Globs resolve against the config file's directory, never the
 * cwd, so running from a subdirectory gives identical results.
 */
export function toScanOptions(loaded: LoadedConfig, options: ResolveOptions = {}): ScanOptions {
  const { config } = loaded;
  const textAttributes = textAttributesOf(config);
  return {
    root: options.root ?? loaded.root,
    rules: fileRules(config.rules),
    ...(config.ignore ? { ignore: config.ignore } : {}),
    ...(textAttributes ? { textAttributes } : {}),
    ...(options.files ? { files: options.files } : {}),
  };
}

export async function scanWithConfig(
  loaded: LoadedConfig,
  options: ResolveOptions = {},
): Promise<Finding[]> {
  return scan(toScanOptions(loaded, options));
}
