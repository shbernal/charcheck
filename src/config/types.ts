import type { Rule } from '../types.js';

export interface MarkupOptions {
  /**
   * Attributes whose value counts as rendered text. Setting this **replaces** the default
   * allowlist rather than extending it: a repo with its own text props wants control over
   * the whole list.
   */
  textAttributes?: string[];
}

export interface CharcheckConfig {
  rules: Rule[];
  /** Applied on top of every rule's own `exclude`. */
  ignore?: string[];
  /**
   * Attributes whose value counts as rendered text, for `markup` and `html` alike. Setting
   * this **replaces** the default allowlist rather than extending it: a repo with its own
   * text props wants control over the whole list. Not a per-rule property.
   */
  textAttributes?: string[];
  /**
   * The former home of `textAttributes`, kept working because it shipped. It was named for
   * `markup` when that was the only scope reading attributes, and `html` reads the same
   * list. Prefer the top-level key; setting both is a config error rather than a silent
   * precedence rule.
   */
  markup?: MarkupOptions;
  /**
   * Record what the repository already has, and fail on the new findings alone. A finding the
   * baseline accounts for is counted in the summary and kept out of the exit code, which is
   * what lets a repository that is not at zero turn this tool on in CI today.
   *
   * `true` means `charcheck-baseline.json` beside this config file. A string is a path, taken
   * relative to the config file's own directory the way every glob is. `--baseline` on the
   * command line wins over either.
   */
  baseline?: string | boolean;
}

export interface LoadedConfig {
  config: CharcheckConfig;
  /** Absolute path of the file the config came from. */
  filepath: string;
  /**
   * The directory every glob is relative to: the config file's own, never the cwd, so
   * running from a subdirectory gives identical results.
   */
  root: string;
}
