import type { Extractor, Scope } from '../types.js';
import { COMMENTS_EXTENSIONS, commentsExtractor } from './comments.js';
import { matchesExtension } from './extensions.js';
import { HTML_EXTENSIONS, htmlExtractor } from './html.js';
import { MARKDOWN_EXTENSIONS, markdownExtractor } from './markdown.js';
import { MARKUP_EXTENSIONS, markupExtractor } from './markup.js';
import { rawExtractor } from './raw.js';
import { STRINGS_EXTENSIONS, stringsExtractor } from './strings.js';

export {
  JsxUnsupportedError,
  MissingPeerDependencyError,
  UnsupportedPeerDependencyError,
} from './missing-peer.js';
export { DEFAULT_TEXT_ATTRIBUTES } from './text-attributes.js';

/**
 * What a scope is, in one place.
 *
 * Every fact the rest of the tool needs about a scope is here: how it reads a file, which
 * files it can read at all, and which optional peers it imports to do it. They were three
 * tables in two files, and adding a scope meant remembering all three.
 *
 * Total in `Scope`, deliberately and in every field. A new scope that fills none of them in
 * is a type error rather than a scope that quietly inherits `raw`'s answers.
 */
interface ScopeDefinition {
  extractor: Extractor;
  /**
   * Extensions this scope can read, or `null` for no restriction.
   *
   * `null` rather than an absent entry, because unrestricted is a decision somebody made
   * about `raw` rather than a table row nobody wrote. When it was an absence, a
   * parser-backed scope left out of the table read as unrestricted, and two checks that
   * exist to catch a rule matching files its scope cannot read went quiet together: the
   * config error for a glob naming an unreadable extension, and the warning for a rule that
   * matched files and could read none of them. Both fail by not firing, which is the failure
   * mode nobody notices.
   */
  extensions: readonly string[] | null;
  /** Optional peers this scope imports lazily, so a bug report names the versions in play. */
  peers: readonly string[];
}

/**
 * The registry. A scope is an extractor, not a branch in the scanner, so a new surface is a
 * new file plus one entry here.
 */
const REGISTRY: Record<Scope, ScopeDefinition> = {
  raw: { extractor: rawExtractor, extensions: null, peers: [] },
  strings: {
    extractor: stringsExtractor,
    extensions: STRINGS_EXTENSIONS,
    peers: ['typescript'],
  },
  comments: {
    extractor: commentsExtractor,
    extensions: COMMENTS_EXTENSIONS,
    peers: ['typescript'],
  },
  markup: {
    extractor: markupExtractor,
    extensions: MARKUP_EXTENSIONS,
    peers: ['typescript', '@vue/compiler-sfc'],
  },
  markdown: { extractor: markdownExtractor, extensions: MARKDOWN_EXTENSIONS, peers: ['micromark'] },
  html: { extractor: htmlExtractor, extensions: HTML_EXTENSIONS, peers: ['parse5'] },
};

export class UnsupportedScopeError extends Error {
  constructor(scope: string) {
    super(`Unknown scope "${scope}".`);
    this.name = 'UnsupportedScopeError';
  }
}

/**
 * The throw is unreachable from TypeScript, since the parameter is a `Scope` and the
 * registry is total in it. It is there for a JavaScript caller, and the error class is
 * exported from the package so one can catch it by type.
 */
export function getExtractor(scope: Scope): Extractor {
  const definition = REGISTRY[scope];
  if (!definition) throw new UnsupportedScopeError(scope);
  return definition.extractor;
}

/** Every scope name, for validating the `scope` a config gives. */
export const SCOPE_NAMES = Object.keys(REGISTRY) as Scope[];

/**
 * The extensions a scope can read, or `null` when it reads anything. For the config check
 * that rejects a rule whose globs name an extension its scope cannot read, which has to
 * name the readable ones in its message rather than only test a file against them.
 */
export function scopeExtensions(scope: Scope): readonly string[] | null {
  return REGISTRY[scope]?.extensions ?? null;
}

export function scopeSupportsFile(scope: Scope, file: string): boolean {
  // Unrestricted for an unknown scope, which is what it answered before the table was total
  // and is the only thing a JavaScript caller passing one can be told.
  const extensions = scopeExtensions(scope);
  return extensions === null || matchesExtension(extensions, file);
}

/** The peers the given scopes need between them, named once each. */
export function peersForScopes(scopes: Iterable<Scope>): string[] {
  const needed = new Set<string>();
  for (const scope of scopes) {
    for (const peer of REGISTRY[scope].peers) needed.add(peer);
  }
  return [...needed].sort();
}
