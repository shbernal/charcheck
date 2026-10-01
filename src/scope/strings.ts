import type typescript from 'typescript';

import type { Chunk, Extractor } from '../types.js';
import { literalRanges, type Range } from './token-scan.js';
import {
  languageForFile,
  parseScript,
  type ScanningApi,
  SCRIPT_EXTENSIONS,
  type ScriptLanguage,
  type ScriptReader,
  scannerRangeReader,
  scriptReader,
} from './typescript-peer.js';

export type { ScriptLanguage } from './typescript-peer.js';

/** Extensions the `strings` scope can parse. Anything else is a config error. */
export const STRINGS_EXTENSIONS = SCRIPT_EXTENSIONS;

/** Reads the string and template literal ranges out of one piece of source. */
export type LiteralReader = ScriptReader;

/**
 * Exported for the equivalence test, which runs both readers over the same corpus and
 * requires identical ranges. That property is the whole justification for having two, so it
 * is worth a seam.
 */
export function astReader(ts: typeof typescript): LiteralReader {
  return (source, language, fileName) => {
    const sourceFile = parseScript(ts, source, language, fileName);

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
  return scannerRangeReader(ast, (scanner, kinds) => literalRanges(scanner, kinds));
}

/**
 * Loads the peer and picks the reader by what it can do, not by what it calls itself, so a
 * major that keeps an API keeps working without a release here.
 */
const loadLiteralReader = scriptReader<LiteralReader>({
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
