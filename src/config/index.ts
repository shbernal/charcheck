/**
 * The `@shbernal/charcheck/config` entry point: everything a config file needs, and
 * nothing that would drag in the CLI.
 */

export { defineConfig } from './define-config.js';
export { validateConfig, ConfigError, patternExtensions, VIRTUAL_PATTERN } from './schema.js';
export { loadConfig, ConfigNotFoundError, CONFIG_FILENAMES } from './load.js';
export type { FindConfigOptions } from './load.js';
export { toScanOptions, scanWithConfig, fileRules, virtualRules } from './resolve.js';
export type { ResolveOptions } from './resolve.js';
export type { CharcheckConfig, LoadedConfig, MarkupOptions } from './types.js';

export { fixStrategies as strategies } from '../fix-strategies.js';
export type { FixStrategyName } from '../fix-strategies.js';
export { DEFAULT_TEXT_ATTRIBUTES } from '../scope/index.js';
export type { FixContext, Rule, Scope, Severity } from '../types.js';
