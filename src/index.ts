/**
 * The programmatic API. A real product surface, not a side effect of the CLI: a consumer
 * can enforce its own rules from a test with no process or exit-code involvement.
 */

export type {
  Chunk,
  Extractor,
  ExtractorOptions,
  FixContext,
  FixFunction,
  Finding,
  Rule,
  Scope,
  Severity,
} from './types.js';

export { scanText, looksBinary, stripBom } from './scan.js';
export type { ScanTextOptions } from './scan.js';
export { scan, DEFAULT_IGNORE } from './scan-files.js';
export type { ScanOptions } from './scan-files.js';
export { applyFixes } from './fix.js';
export { clauseSeparator, fixStrategies, isFixStrategyName } from './fix-strategies.js';
export type { FixStrategyName } from './fix-strategies.js';
export { compileRule, RuleError } from './rule.js';
export type { CompiledRule } from './rule.js';
export {
  MissingPeerDependencyError,
  UnsupportedScopeError,
  scopeSupportsFile,
} from './scope/index.js';
export { relativeToRoot, toPosix } from './paths.js';
export * as chars from './chars.js';
