/**
 * The `typescript` peer, resolved once and shared by every scope that reads a script file.
 *
 * Two scopes read TS/JS source directly, `strings` and `comments`, and `markup` and `html`
 * reach one of them for the script blocks they hold. All of them need the same three
 * things: which extensions are script files, which language a file is, and which of the two
 * TypeScript APIs the installed package actually offers. Keeping that here is what stops a
 * second scope from growing a second answer to any of them.
 *
 * The API is chosen by capability, never by version number, so a later major that keeps one
 * of the two shapes keeps working with no release here.
 */

import type typescript from 'typescript';

import { importPeer, UnsupportedPeerDependencyError } from './missing-peer.js';
import type { TokenScanner } from './token-scan.js';

/**
 * The peer range these scopes can parse with. Wide, because it is satisfied two different
 * ways: TypeScript 5 and 6 expose a parser and are read through their syntax tree, while
 * TypeScript 7 exposes only a scanner and is read token by token.
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

/** Extensions a script scope can parse. Anything else is a config error. */
export const SCRIPT_EXTENSIONS = [...EXTENSION_LANGUAGE.keys()];

function extensionOf(file: string): string {
  const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

export function languageForFile(file: string): ScriptLanguage | undefined {
  return EXTENSION_LANGUAGE.get(extensionOf(file));
}

export function isJsx(language: ScriptLanguage): boolean {
  return language === 'tsx' || language === 'jsx';
}

/** The shape TypeScript 7's `unstable/ast` is used through, which its own types do not describe here. */
export interface ScanningApi {
  createScanner: (
    skipTrivia: boolean,
    languageVariant?: number,
    textInitial?: string,
    start?: number,
    length?: number,
  ) => TokenScanner;
  SyntaxKind?: Record<string, unknown>;
  LanguageVariant?: Record<string, unknown>;
}

/** What the installed package turned out to be, once the capability test has run. */
export type TypeScriptApi =
  | { kind: 'parser'; parser: typeof typescript }
  | { kind: 'scanner'; scanning: ScanningApi };

/**
 * The decision, once. It is made from the installed package, which cannot change inside a
 * run, and every file in a scan would otherwise repeat the import behind it. Only a success
 * is kept: a failure names the scope that asked, and the next scope to ask deserves its own
 * name in the message.
 */
let cachedApi: TypeScriptApi | undefined;

export async function loadTypeScript(scope: string): Promise<TypeScriptApi> {
  if (cachedApi !== undefined) return cachedApi;

  const loaded = await importPeer('typescript', scope, () => import('typescript'));
  // The package is CommonJS, so an interop default may wrap the namespace.
  const ts = ((loaded as { default?: typeof typescript }).default ?? loaded) as typeof typescript;

  const api = ts as Partial<typeof typescript>;
  if (typeof api.createSourceFile === 'function' && typeof api.forEachChild === 'function') {
    return (cachedApi = { kind: 'parser', parser: ts });
  }

  // TypeScript 7 and later: the parser is gone from the package root and a scanner is what
  // is left. The specifier is a variable because a TypeScript 5 install does not export the
  // subpath at all, and a literal would be a build error against those types.
  const modern = await import(MODERN_AST_MODULE).catch(() => undefined);
  const scanning = ((modern as { default?: ScanningApi } | undefined)?.default ?? modern) as
    | ScanningApi
    | undefined;
  if (typeof scanning?.createScanner === 'function') {
    return (cachedApi = { kind: 'scanner', scanning });
  }

  throw new UnsupportedPeerDependencyError('typescript', scope, api.version, SUPPORTED_TYPESCRIPT);
}

/** How TypeScript names each of the four languages, for `createSourceFile`. */
export function scriptKindFor(
  ts: typeof typescript,
  language: ScriptLanguage,
): typescript.ScriptKind {
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

/** How a scope turns whichever API is installed into the reader it wants. */
export interface ReaderBuilders<Reader> {
  fromParser: (ts: typeof typescript) => Reader;
  fromScanner: (scanning: ScanningApi) => Reader;
}

/** Every memoized reader, so `resetTypeScript` can drop all of them together. */
const readerCaches: (() => void)[] = [];

/**
 * A scope's reader, built once from the API decision above.
 *
 * The reader is memoized separately from the API because building one is not free either:
 * the scanner reader resolves a token-kind table, and doing that per file in a scan of a
 * large tree is pure waste.
 */
export function scriptReader<Reader>(
  build: ReaderBuilders<Reader>,
): (scope: string) => Promise<Reader> {
  let cached: Reader | undefined;
  readerCaches.push(() => {
    cached = undefined;
  });

  return async (scope: string): Promise<Reader> => {
    if (cached !== undefined) return cached;
    const api = await loadTypeScript(scope);
    return (cached =
      api.kind === 'parser' ? build.fromParser(api.parser) : build.fromScanner(api.scanning));
  };
}

/**
 * Drops the API decision and every reader built from it, so the next call decides again.
 *
 * For a test that has to observe the decision itself, which is otherwise made once per
 * process and inherited by every test after the first one to scan anything. Not exported
 * from the package: a scan cannot want this, because the installed package cannot change
 * while one is running.
 *
 * All of it goes at once. A reader outliving the decision it was built from is a state no
 * run can reach and no test would mean to ask for.
 */
export function resetTypeScript(): void {
  cachedApi = undefined;
  for (const drop of readerCaches) drop();
}
