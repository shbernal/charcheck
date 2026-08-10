import type typescript from 'typescript';

import type { Chunk, Extractor } from '../types.js';
import { importPeer, UnsupportedPeerDependencyError } from './missing-peer.js';

/**
 * The versions this scope can actually parse with, which is deliberately narrower than the
 * `typescript` peer range in package.json. The peer range is wide because the dependency is
 * optional and two of the three scopes never load it: a narrow range there makes charcheck
 * uninstallable under npm for a project on an unsupported TypeScript, even one that only
 * ever scans raw text. So installation stays open and the real constraint is enforced here,
 * where it can be reported to the person who asked for the scope.
 */
export const SUPPORTED_TYPESCRIPT = '>=5 <7';

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

export async function loadTypeScript(scope: string): Promise<typeof typescript> {
  const loaded = await importPeer('typescript', scope, () => import('typescript'));
  // The package is CommonJS, so an interop default may wrap the namespace.
  const ts = ((loaded as { default?: typeof typescript }).default ?? loaded) as typeof typescript;

  // Tested by capability rather than by version, so a later major that keeps the API works
  // without a release here, and one that drops it is caught whatever it calls itself.
  const api = ts as Partial<typeof typescript>;
  if (typeof api.createSourceFile !== 'function' || typeof api.forEachChild !== 'function') {
    throw new UnsupportedPeerDependencyError(
      'typescript',
      scope,
      api.version,
      SUPPORTED_TYPESCRIPT,
    );
  }

  return ts;
}

function scriptKindFor(ts: typeof typescript, language: ScriptLanguage): typescript.ScriptKind {
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
  const ts = await loadTypeScript(scope);

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKindFor(ts, language),
  );

  const chunks: Chunk[] = [];
  const visit = (node: typescript.Node): void => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        // The raw source slice, never the cooked value: an escape sequence makes the two
        // different lengths and every position computed against the cooked one is wrong.
        chunks.push({
          start: node.getStart(sourceFile) + offset,
          end: node.getEnd() + offset,
          container: 'self',
        });
        break;
      default:
        break;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return chunks;
}

export const stringsExtractor: Extractor = async (text, file) => {
  const language = languageForFile(file);
  if (language === undefined) return [];
  return extractLiteralChunks(text, { language, fileName: file, scope: 'strings' });
};
