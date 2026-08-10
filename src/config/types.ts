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
  /** What counts as rendered text in this repo's components. Not a per-rule property. */
  markup?: MarkupOptions;
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
