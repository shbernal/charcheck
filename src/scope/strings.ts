import type typescript from 'typescript';

import type { Chunk, Extractor } from '../types.js';
import { importPeer, JsxUnsupportedError, UnsupportedPeerDependencyError } from './missing-peer.js';
import { resolveTokenKinds } from './token-kinds.js';
import { literalRanges, type Range, type TokenScanner } from './token-scan.js';

/**
 * The peer range this scope can parse with. Wide, because it is now satisfied two different
 * ways: TypeScript 5 and 6 expose a parser and are read through their syntax tree, while
 * TypeScript 7 exposes only a scanner and is read token by token. Neither is version
 * sniffed; the capability is tested. See `loadLiteralReader`.
 */
export const SUPPORTED_TYPESCRIPT = '>=5';

/** Where TypeScript 7 moved the scanner to. Unstable upstream, and pinned to nothing here. */
const MODERN_AST_MODULE = 'typescript/unstable/ast';

export type ScriptLanguage = 'ts' | 'tsx' | 'js' | 'jsx';

const EXTENSION_LANGUAGE = new Map<string, ScriptLanguage>([
  ['.ts', 'ts'],
  ['.mts', 'ts'],
  ['.cts', 'ts'],
  ['.tsx', 'tsx'],
  ['.js', 'js'],
  ['.mjs', 'js'],
  ['.cjs', 'js'],
  ['.jsx', 'jsx'],
]);

/** Extensions the `strings` scope can parse. Anything else is a config error. */
export const STRINGS_EXTENSIONS = [...EXTENSION_LANGUAGE.keys()];

function extensionOf(file: string): string {
  const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

export function languageForFile(file: string): ScriptLanguage | undefined {
  return EXTENSION_LANGUAGE.get(extensionOf(file));
}

function isJsx(language: ScriptLanguage): boolean {
  return language === 'tsx' || language === 'jsx';
}

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

/** The shape TypeScript 7's `unstable/ast` is used through, which its own types do not describe here. */
interface ModernAst {
  createScanner?: (
    skipTrivia: boolean,
    languageVariant?: number,
    textInitial?: string,
    start?: number,
    length?: number,
  ) => TokenScanner;
  SyntaxKind?: Record<string, unknown>;
  LanguageVariant?: Record<string, unknown>;
}

/**
 * Exported for the equivalence test, which runs both readers over the same corpus and
 * requires identical ranges. That property is the whole justification for having two, so it
 * is worth a seam.
 */
export function astReader(ts: typeof typescript): LiteralReader {
  const scriptKindFor = (language: ScriptLanguage): typescript.ScriptKind => {
    switch (language) {
      case 'ts':
        return ts.ScriptKind.TS;
      case 'tsx':
        return ts.ScriptKind.TSX;
      case 'jsx':
        return ts.ScriptKind.JSX;
      case 'js':
        return ts.ScriptKind.JS;
    }
  };

  return (source, language, fileName) => {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      false,
      scriptKindFor(language),
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
export function scannerReader(
  ast: Required<Pick<ModernAst, 'createScanner'>> & ModernAst,
): LiteralReader {
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
 * The reader, once. Which one to use is decided from the installed package, which cannot
 * change inside a run, and every file in a scan would otherwise repeat the import and the
 * token-kind resolution behind it. Only a success is kept: a failure names the scope that
 * asked, and the next scope to ask deserves its own name in the message.
 */
let cachedReader: LiteralReader | undefined;

/**
 * Loads the peer and picks the reader by what it can do, not by what it calls itself, so a
 * major that keeps an API keeps working without a release here.
 */
export async function loadLiteralReader(scope: string): Promise<LiteralReader> {
  if (cachedReader !== undefined) return cachedReader;

  const loaded = await importPeer('typescript', scope, () => import('typescript'));
  // The package is CommonJS, so an interop default may wrap the namespace.
  const ts = ((loaded as { default?: typeof typescript }).default ?? loaded) as typeof typescript;

  const api = ts as Partial<typeof typescript>;
  if (typeof api.createSourceFile === 'function' && typeof api.forEachChild === 'function') {
    return (cachedReader = astReader(ts));
  }

  // TypeScript 7 and later: the parser is gone from the package root and a scanner is what
  // is left. The specifier is a variable because a TypeScript 5 install does not export the
  // subpath at all, and a literal would be a build error against those types.
  const modern = await import(MODERN_AST_MODULE).catch(() => undefined);
  const scanning = ((modern as { default?: ModernAst } | undefined)?.default ?? modern) as
    | ModernAst
    | undefined;
  if (typeof scanning?.createScanner === 'function') {
    return (cachedReader = scannerReader(
      scanning as Required<Pick<ModernAst, 'createScanner'>> & ModernAst,
    ));
  }

  throw new UnsupportedPeerDependencyError('typescript', scope, api.version, SUPPORTED_TYPESCRIPT);
}

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
