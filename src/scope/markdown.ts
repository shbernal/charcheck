import type { Chunk, Extractor } from '../types.js';
import { importPeer } from './missing-peer.js';

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/**
 * `.mdx` is deliberately absent. It needs the JSX reader and inherits its TypeScript 7
 * limitation, so it is a separate surface rather than a spelling of this one.
 */

/**
 * Prose arrives as `data` tokens, and micromark gives code, raw HTML and autolinks their own
 * token types (`codeFlowValue`, `codeTextData`, `htmlFlowData`, `autolinkProtocol`), so
 * collecting `data` excludes all of them without naming them.
 *
 * These six are the exceptions: they are spelled `data` and are still machinery. A link
 * target is not read by anyone, a reference label is an internal name rather than rendered
 * text, and a fence's info and meta are the language tag and its options. The list was taken
 * from the parser rather than guessed: it is every container of a `data` token, over a
 * document exercising each construct, that is not prose. The others are `paragraph`,
 * `atxHeadingText`, `setextHeadingText`, `emphasisText`, `strongText`, `labelText` and the
 * two title strings, all of which are kept.
 *
 * Link and image titles are deliberately absent from this list. They surface as tooltips, so
 * they are prose, and so is the label text carrying a link's words and an image's alt text.
 */
const NOT_PROSE = new Set([
  'resourceDestinationString',
  'definitionDestinationString',
  'definitionLabelString',
  'referenceString',
  'codeFencedFenceInfo',
  'codeFencedFenceMeta',
]);

/** The slice of micromark's event stream this needs, described structurally. */
interface Token {
  type: string;
  start: { offset: number };
  end: { offset: number };
}

type Event = [kind: string, token: Token];

const FRONTMATTER_OPEN = /^---[ \t]*\r?\n/;
const FRONTMATTER_CLOSE = /^(---|\.\.\.)[ \t]*\r?$/;

/**
 * A hard wrap inside one paragraph, which is a line ending plus whatever prefix the next
 * line needs to stay in its block quote or list item. Prose that a person wrapped is still
 * one run of prose, so the chunks either side of such a gap are joined: without this a rule
 * whose pattern spans a space would match in `raw` and not here, purely because the author
 * pressed Enter. Two line endings are a paragraph break and are never joined.
 */
const HARD_WRAP = /^[^\S\r\n]*\r?\n[ \t>]*$/;

interface Span {
  start: number;
  end: number;
}

/**
 * Frontmatter is handled here rather than left to micromark, which without an extension
 * reads `---` as a thematic break and the block below it as ordinary Markdown. That mostly
 * lands on the right answer by accident, and fails badly in one case: a backtick fence
 * inside a value would open a code block and silence the rest of the document.
 *
 * The whole block counts as prose. A `description:` is rendered on a page and a `slug:` is
 * not, but guessing per key means knowing every convention of every site generator, and the
 * cost of covering a key that is never displayed is a finding in text nobody reads.
 */
function splitFrontmatter(text: string): { body: Span; rest: number } | undefined {
  const open = FRONTMATTER_OPEN.exec(text);
  if (!open) return undefined;

  const bodyStart = open[0].length;
  let cursor = bodyStart;
  while (cursor <= text.length) {
    const lineEnd = text.indexOf('\n', cursor);
    const stop = lineEnd === -1 ? text.length : lineEnd;
    if (FRONTMATTER_CLOSE.test(text.slice(cursor, stop))) {
      return {
        body: { start: bodyStart, end: cursor },
        rest: lineEnd === -1 ? text.length : lineEnd + 1,
      };
    }
    if (lineEnd === -1) return undefined;
    cursor = lineEnd + 1;
  }
  // An opening delimiter with no closing one is not frontmatter, it is a thematic break.
  return undefined;
}

function collectProse(events: readonly Event[], offset: number): Span[] {
  const spans: Span[] = [];
  let skipping = 0;

  for (const [kind, token] of events) {
    if (NOT_PROSE.has(token.type)) {
      if (kind === 'enter') skipping += 1;
      else skipping -= 1;
      continue;
    }
    if (kind !== 'enter' || token.type !== 'data' || skipping > 0) continue;
    spans.push({ start: token.start.offset + offset, end: token.end.offset + offset });
  }

  return spans;
}

function joinHardWraps(spans: readonly Span[], text: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const span of spans) {
    if (span.end <= span.start) continue;
    const previous = chunks.at(-1);
    if (previous && HARD_WRAP.test(text.slice(previous.end, span.start))) {
      previous.end = span.end;
      continue;
    }
    // A fix reads the enclosing sentence, not the chunk. Markdown prose is hard-wrapped the
    // same way raw prose is, so the unit a fix has to decide from is the same one.
    chunks.push({ start: span.start, end: span.end, container: 'sentence' });
  }

  return chunks;
}

export const markdownExtractor: Extractor = async (text, file) => {
  if (!MARKDOWN_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension))) return [];
  if (text.length === 0) return [];

  const { parse, postprocess, preprocess } = await importPeer(
    'micromark',
    'markdown',
    () => import('micromark'),
  );

  const frontmatter = splitFrontmatter(text);
  const body = frontmatter ? text.slice(frontmatter.rest) : text;
  const offset = frontmatter ? frontmatter.rest : 0;

  // `postprocess` is what subtokenizes a paragraph into inline tokens, so the `data` this
  // reads does not exist before it runs.
  const events = postprocess(
    parse(undefined)
      .document()
      .write(preprocess()(body, null, true)),
  ) as unknown as Event[];

  const spans = collectProse(events, offset);
  if (frontmatter && frontmatter.body.end > frontmatter.body.start) spans.unshift(frontmatter.body);

  return joinHardWraps(spans, text);
};
