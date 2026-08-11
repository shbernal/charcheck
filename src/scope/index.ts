import type { Extractor, Scope } from '../types.js';
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
export { DEFAULT_TEXT_ATTRIBUTES } from './markup.js';

/**
 * The scope table. A scope is an extractor, not a branch in the scanner, so a new surface
 * is a new file plus one entry here.
 */
const EXTRACTORS: Record<Scope, Extractor> = {
  raw: rawExtractor,
  strings: stringsExtractor,
  markup: markupExtractor,
  markdown: markdownExtractor,
  html: htmlExtractor,
};

export class UnsupportedScopeError extends Error {
  constructor(scope: string) {
    super(`Unknown scope "${scope}".`);
    this.name = 'UnsupportedScopeError';
  }
}

export function getExtractor(scope: Scope): Extractor {
  const extractor = EXTRACTORS[scope];
  if (!extractor) throw new UnsupportedScopeError(scope);
  return extractor;
}

export const SCOPES = Object.keys(EXTRACTORS) as Scope[];

/**
 * Extensions each parser-backed scope understands. `raw` has no restriction, so it is
 * absent here. Used to reject, at config load time, a rule whose globs can only ever match
 * files its scope cannot read.
 */
export const SCOPE_EXTENSIONS: Partial<Record<Scope, readonly string[]>> = {
  strings: STRINGS_EXTENSIONS,
  markup: MARKUP_EXTENSIONS,
  markdown: MARKDOWN_EXTENSIONS,
  html: HTML_EXTENSIONS,
};

export function scopeSupportsFile(scope: Scope, file: string): boolean {
  const extensions = SCOPE_EXTENSIONS[scope];
  if (!extensions) return true;
  const lower = file.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}
