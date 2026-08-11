import type { Chunk, Extractor } from '../types.js';
import { matchesExtension } from './extensions.js';
import { importPeer } from './missing-peer.js';
import { extractLiteralChunks } from './strings.js';
import { allows, DEFAULT_TEXT_ATTRIBUTES } from './text-attributes.js';

export const HTML_EXTENSIONS = ['.html', '.htm'];

/**
 * Elements whose contents are never prose. `style` for the reason `markup` skips it, and the
 * code-ish set for the reason `markdown` skips fences and inline code: a documented shell
 * command is not text a rule should read, whichever surface it is written on.
 */
const NEVER_PROSE = new Set(['style', 'code', 'pre', 'samp', 'kbd', 'var']);

/**
 * Script types read as JavaScript. `application/json`, `application/ld+json` and the
 * `text/x-template` family are data or markup wearing a script tag: reading them as code
 * would parse them as a sequence of syntax errors and match nothing.
 */
const JS_SCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
]);

/** The slice of parse5's tree this needs, described structurally, as `markup` does for Vue. */
interface Offsets {
  startOffset: number;
  endOffset: number;
}

interface Location extends Offsets {
  attrs?: Record<string, Offsets>;
}

interface Node {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  /** A `<template>` holds its children here rather than in `childNodes`. */
  content?: Node;
  sourceCodeLocation?: Location | null;
}

interface Span {
  start: number;
  end: number;
}

/**
 * The default tree adapter concatenates a run of text onto the text node before it, and the
 * parser then stretches that node's location to the end of the run it appended. Two runs
 * separated by markup therefore share one span covering the markup between them: after
 * `</body>`, `hello<!-- comment -->tail` is a single node whose source range includes the
 * comment. Reading that range would report a character inside a comment, which every other
 * scope in this tool treats as exempt.
 *
 * Overriding both insertion points to always append a fresh node keeps each run on the exact
 * location the tokenizer gave it. Nothing else about tree construction changes, so an
 * implied `<body>`, a foster-parented cell and a `<template>` all still land where the spec
 * says. Contiguous runs are rejoined below.
 */
function splitTextAdapter(base: Record<string, unknown>): Record<string, unknown> {
  const appendChild = base['appendChild'] as (parent: unknown, node: unknown) => void;
  const insertBefore = base['insertBefore'] as (p: unknown, n: unknown, ref: unknown) => void;
  const createTextNode = base['createTextNode'] as (value: string) => unknown;

  return {
    ...base,
    insertText(parent: unknown, text: string): void {
      appendChild(parent, createTextNode(text));
    },
    insertTextBefore(parent: unknown, text: string, reference: unknown): void {
      insertBefore(parent, createTextNode(text), reference);
    },
  };
}

/**
 * parse5 locates an attribute as the whole `name="value"` run, so the value is found within
 * it. Unquoted and valueless forms both occur in documents people actually write.
 */
function attributeValueSpan(text: string, location: Offsets): Span | undefined {
  const source = text.slice(location.startOffset, location.endOffset);
  const equals = source.indexOf('=');
  if (equals === -1) return undefined;

  let cursor = equals + 1;
  while (cursor < source.length && /\s/.test(source[cursor]!)) cursor += 1;
  if (cursor >= source.length) return undefined;

  const quote = source[cursor];
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, cursor + 1);
    if (close === -1) return undefined;
    return { start: location.startOffset + cursor + 1, end: location.startOffset + close };
  }
  return { start: location.startOffset + cursor, end: location.endOffset };
}

function attributeOf(node: Node, name: string): string | undefined {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}

/**
 * Text runs that touch in the source are one run of prose, so a rule whose pattern spans a
 * space still matches across a hard wrap. Markup between two runs breaks the join, which is
 * what keeps a comment or a `<code>` element out of the text around it.
 *
 * The joining has to happen before whitespace-only runs are dropped, not after. The
 * tokenizer emits whitespace as its own character token, so `one <em>` arrives as `one` and
 * ` ` and dropping the second first would leave two chunks with a gap between them, where a
 * pattern spanning the space then fails to match. Once joined, a run that is still only
 * whitespace is the indentation between two elements and is nobody's prose.
 */
function joinContiguous(spans: Span[], text: string): Chunk[] {
  const joined: Span[] = [];

  for (const span of spans.sort((a, b) => a.start - b.start)) {
    const previous = joined.at(-1);
    if (previous && previous.end === span.start) previous.end = span.end;
    else joined.push({ ...span });
  }

  // A fix reads the enclosing sentence, as in `markdown` and unlike `markup`: an HTML
  // paragraph is hard-wrapped prose, where a Vue template's text is usually a label.
  return joined
    .filter((span) => text.slice(span.start, span.end).trim().length > 0)
    .map((span) => ({ start: span.start, end: span.end, container: 'sentence' as const }));
}

export const htmlExtractor: Extractor = async (text, file, options) => {
  if (!matchesExtension(HTML_EXTENSIONS, file)) return [];

  const { parse, defaultTreeAdapter } = await importPeer('parse5', 'html', () => import('parse5'));

  const attributes = new Set(options?.textAttributes ?? DEFAULT_TEXT_ATTRIBUTES);
  const chunks: Chunk[] = [];
  const textSpans: Span[] = [];

  // `scriptingEnabled: false` so a `<noscript>` body is parsed as elements rather than
  // handed over as one raw-text blob. Its prose renders for the readers who see it.
  const document = parse(text, {
    sourceCodeLocationInfo: true,
    scriptingEnabled: false,
    treeAdapter: splitTextAdapter(
      defaultTreeAdapter as unknown as Record<string, unknown>,
    ) as never,
  }) as unknown as Node;

  const script = async (node: Node): Promise<void> => {
    const type = (attributeOf(node, 'type') ?? '').trim().toLowerCase();
    if (!JS_SCRIPT_TYPES.has(type)) return;

    // The adapter above splits text, and a script body is no exception: it arrives as the
    // several character tokens the tokenizer emitted. They are one contiguous run, because
    // script data is raw text with no markup to interrupt it, so the body is the span from
    // the first to the last.
    const body = (node.childNodes ?? []).filter((child) => child.nodeName === '#text');
    const start = body[0]?.sourceCodeLocation?.startOffset;
    const end = body.at(-1)?.sourceCodeLocation?.endOffset;
    if (start === undefined || end === undefined) return;

    chunks.push(
      ...(await extractLiteralChunks(text.slice(start, end), {
        offset: start,
        language: 'js',
        fileName: file,
        scope: 'html',
      })),
    );
  };

  const visit = async (node: Node): Promise<void> => {
    // A comment is `#comment` and a doctype `#documentType`. Both fall through untouched,
    // for the reason a code comment does under `strings`.
    if (node.nodeName === '#text') {
      const location = node.sourceCodeLocation;
      if (location) textSpans.push({ start: location.startOffset, end: location.endOffset });
      return;
    }

    const tag = node.tagName;
    const attributeLocations = node.sourceCodeLocation?.attrs;
    if (attributeLocations) {
      for (const attribute of node.attrs ?? []) {
        // parse5 lowercases both the tag and the attribute name, which is the spelling the
        // allowlist is written in.
        const location = attributeLocations[attribute.name];
        if (!location || !allows(attributes, tag, attribute.name)) continue;
        const span = attributeValueSpan(text, location);
        if (span && span.end > span.start) {
          chunks.push({ start: span.start, end: span.end, container: 'self' });
        }
      }
    }

    if (tag === 'script') {
      await script(node);
      return;
    }
    if (tag !== undefined && NEVER_PROSE.has(tag)) return;

    for (const child of node.childNodes ?? []) await visit(child);
    // A `<template>` keeps its children off `childNodes`, so they are reached here or not at
    // all. Its text does render, once something clones it.
    if (node.content) await visit(node.content);
  };

  await visit(document);
  chunks.push(...joinContiguous(textSpans, text));

  // Fixes are applied to the original text at these offsets, so parse5's normalization, the
  // implied `<html>`/`<head>`/`<body>` and the decoded character references, never reaches
  // disk. A `&amp;` is therefore read as the source wrote it, as it is under `markdown`.
  return chunks;
};
