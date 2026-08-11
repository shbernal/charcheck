import type { Chunk, Extractor } from '../types.js';
import { matchesExtension } from './extensions.js';
import { importPeer } from './missing-peer.js';
import { extractLiteralChunks } from './strings.js';
import type { ScriptLanguage } from './strings.js';
import { allows, DEFAULT_TEXT_ATTRIBUTES } from './text-attributes.js';

export const MARKUP_EXTENSIONS = ['.vue'];

/**
 * Node kinds from the Vue compiler's `NodeTypes` enum, which the package does not export
 * at runtime. Pinned here, and covered by the fixture tests: a renumbering upstream would
 * show up as findings appearing in the wrong places rather than as a type error.
 */
const NODE_ELEMENT = 1;
const NODE_TEXT = 2;
const NODE_INTERPOLATION = 5;
const NODE_ATTRIBUTE = 6;
const NODE_DIRECTIVE = 7;

/**
 * The slice of the AST this extractor needs, described structurally so it does not have to
 * track the compiler's exported type names.
 */
interface Loc {
  start: { offset: number };
  end: { offset: number };
  source: string;
}

interface AstNode {
  type: number;
  loc: Loc;
  tag?: string;
  name?: string;
  children?: unknown;
  props?: AstNode[];
  value?: AstNode;
  arg?: AstNode;
  exp?: AstNode;
  content?: unknown;
}

interface Block {
  content: string;
  lang?: string;
  loc: Loc;
}

function languageFor(lang: string | undefined): ScriptLanguage {
  switch (lang) {
    case 'ts':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'jsx':
      return 'jsx';
    default:
      return 'js';
  }
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value && 'loc' in value;
}

/** The static name of a bound attribute: `:title` and `v-bind:title` are both `title`. */
function boundAttributeName(node: AstNode): string | undefined {
  if (node.name !== 'bind') return undefined;
  const arg = node.arg;
  if (!arg || typeof arg.content !== 'string') return undefined;
  return arg.content;
}

export const markupExtractor: Extractor = async (text, file, options) => {
  if (!matchesExtension(MARKUP_EXTENSIONS, file)) return [];

  const { parse } = await importPeer(
    '@vue/compiler-sfc',
    'markup',
    () => import('@vue/compiler-sfc'),
  );

  const attributes = new Set(options?.textAttributes ?? DEFAULT_TEXT_ATTRIBUTES);
  const { descriptor } = parse(text, { filename: file });
  const chunks: Chunk[] = [];

  // Every offset below is absolute in the original file. Template AST nodes already are;
  // a script block's content is re-parsed standalone and so needs its block offset added.
  const expression = async (node: AstNode, fileName: string): Promise<void> => {
    const source = node.loc.source;
    if (source.trim().length === 0) return;
    chunks.push(
      ...(await extractLiteralChunks(source, {
        offset: node.loc.start.offset,
        language: 'ts',
        fileName,
        scope: 'markup',
      })),
    );
  };

  const visit = async (node: AstNode, tag: string | undefined): Promise<void> => {
    switch (node.type) {
      case NODE_TEXT:
        chunks.push({ start: node.loc.start.offset, end: node.loc.end.offset, container: 'self' });
        break;

      case NODE_INTERPOLATION:
        // A banned character can only reach the page through a literal in the expression;
        // an identifier cannot contain one. Reuse the literal collector rather than
        // reimplementing it.
        if (isAstNode(node.content)) await expression(node.content, file);
        break;

      case NODE_ATTRIBUTE:
        if (node.name && node.value && allows(attributes, tag, node.name)) {
          chunks.push({
            start: node.value.loc.start.offset,
            end: node.value.loc.end.offset,
            container: 'self',
          });
        }
        break;

      case NODE_DIRECTIVE: {
        const bound = boundAttributeName(node);
        if (bound && node.exp && allows(attributes, tag, bound)) {
          await expression(node.exp, file);
        }
        break;
      }

      default:
        break;
    }

    // Comments are node type 3 and fall through the switch untouched, which is the point:
    // a template comment is exempt for the same reason a code comment is.
    const ownTag = node.type === NODE_ELEMENT ? node.tag : tag;
    for (const prop of node.props ?? []) await visit(prop, ownTag);
    if (Array.isArray(node.children)) {
      for (const child of node.children) if (isAstNode(child)) await visit(child, ownTag);
    }
  };

  const template = descriptor.template as { ast?: AstNode } | null;
  if (template?.ast) await visit(template.ast, undefined);

  // Both blocks can be present, and a `lang="ts"` block parsed as JavaScript would
  // silently skip anything type-annotated.
  for (const block of [descriptor.script, descriptor.scriptSetup] as (Block | null)[]) {
    if (!block) continue;
    chunks.push(
      ...(await extractLiteralChunks(block.content, {
        offset: block.loc.start.offset,
        language: languageFor(block.lang),
        fileName: file,
        scope: 'markup',
      })),
    );
  }

  // `<style>` and custom blocks are never visited. Fixes are applied to the original text
  // at these offsets, so the compiler's output never reaches disk.
  return chunks;
};
