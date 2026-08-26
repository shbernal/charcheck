import type typescript from 'typescript';

import type { Chunk, Extractor } from '../types.js';
import { JsxUnsupportedError } from './missing-peer.js';
import { resolveTokenKinds } from './token-kinds.js';
import { literalRanges, type Range } from './token-scan.js';
import {
  isJsx,
  languageForFile,
  SCRIPT_EXTENSIONS,
  type ScanningApi,
  scriptKindFor,
  type ScriptLanguage,
  scriptReader,
} from './typescript-peer.js';

export { resetTypeScript, SUPPORTED_TYPESCRIPT } from './typescript-peer.js';
export type { ScriptLanguage } from './typescript-peer.js';

/** Extensions the `strings` scope can parse. Anything else is a config error. */
export const STRINGS_EXTENSIONS = SCRIPT_EXTENSIONS;

/**
 * Reads the string and template literal ranges out of one piece of source. Which TypeScript
 * is installed decides how; nothing above this line knows the difference.
 */
export type LiteralReader = (
  source: string,
  language: ScriptLanguage,
  fileName: string,
  scope: string,
) => Range[];

/**
 * Exported for the equivalence test, which runs both readers over the same corpus and
 * requires identical ranges. That property is the whole justification for having two, so it
 * is worth a seam.
 */
export function astReader(ts: typeof typescript): LiteralReader {
  return (source, language, fileName) => {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      false,
      scriptKindFor(ts, language),
    );

    const ranges: Range[] = [];
    const visit = (node: typescript.Node): void => {
      switch (node.kind) {
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        case ts.SyntaxKind.TemplateHead:
        case ts.SyntaxKind.TemplateMiddle:
        case ts.SyntaxKind.TemplateTail: {
          // The raw source slice, never the cooked value: an escape sequence makes the two
          // different lengths and every position computed against the cooked one is wrong.
          const start = node.getStart(sourceFile);
          const end = node.getEnd();
          // Malformed source yields empty literals, and the two readers disagree about how
          // many. None of them can hold a banned character, so neither reader reports one.
          if (end > start) ranges.push({ start, end });
          break;
        }
        default:
          break;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return ranges;
  };
}

/** Exported for the same reason as `astReader`. */
export function scannerReader(ast: ScanningApi): LiteralReader {
  const kinds = resolveTokenKinds(ast.SyntaxKind ?? {});
  const standard = ast.LanguageVariant?.['Standard'];

  return (source, language, fileName, scope) => {
    // A scanner has no way to know it is inside a JSX element, and read as ordinary code
    // an apostrophe in JSX text opens a string literal that runs to the next quote. That
    // would report text no reader sees and hide text they do. Refused instead.
    if (isJsx(language)) throw new JsxUnsupportedError(fileName, scope);

    const scanner = ast.createScanner(
      true,
      typeof standard === 'number' ? standard : undefined,
      source,
    );
    return literalRanges(scanner, kinds);
  };
}

/**
 * Loads the peer and picks the reader by what it can do, not by what it calls itself, so a
 * major that keeps an API keeps working without a release here.
 */
export const loadLiteralReader = scriptReader<LiteralReader>({
  fromParser: astReader,
  fromScanner: scannerReader,
});

export interface LiteralChunkOptions {
  /** Added to every returned offset, so chunks are absolute in the original file. */
  offset?: number;
  language?: ScriptLanguage;
  fileName?: string;
  /** Which scope is asking, for the missing-dependency message. */
  scope?: string;
}

/**
 * String and template literal ranges in a piece of TS/JS source.
 *
 * Callable on an embedded block, not only a whole file, because a component's `<script>`
 * and its template expressions get the same treatment.
 */
export async function extractLiteralChunks(
  source: string,
  options: LiteralChunkOptions = {},
): Promise<Chunk[]> {
  const { offset = 0, language = 'ts', fileName = 'source.ts', scope = 'strings' } = options;
  const read = await loadLiteralReader(scope);

  return read(source, language, fileName, scope).map((range) => ({
    start: range.start + offset,
    end: range.end + offset,
    container: 'self' as const,
  }));
}

export const stringsExtractor: Extractor = async (text, file) => {
  const language = languageForFile(file);
  if (language === undefined) return [];
  return extractLiteralChunks(text, { language, fileName: file, scope: 'strings' });
};
