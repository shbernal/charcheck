/**
 * The `comments` scope: the text a person wrote in a source file that is not addressed to
 * the machine.
 *
 * It is the complement of `strings` over the same files, and the two exist for opposite
 * audiences. A rule whose subject is rendered output wants `strings`, because a dash in a
 * comment is a note to another developer. A rule whose subject is the quality of authored
 * prose wants this one, because the comment is exactly the region a person wrote. Before it
 * existed the union of the two was inexpressible: `raw` reads it and also every identifier,
 * import specifier and regular expression in the file.
 *
 * Delimiters are part of the comment. `//`, `/*`, the closing pair and a doc comment's
 * leading star on each line are all inside the reported range, which keeps a finding's
 * column where `raw` would have put it and keeps a suppression marker and the reason written
 * beside it readable to a rule, as it is under `raw` today.
 */

import type typescript from 'typescript';

import type { Extractor } from '../types.js';
import { commentRanges, type Range } from './token-scan.js';
import {
  languageForFile,
  parseScript,
  type ScanningApi,
  SCRIPT_EXTENSIONS,
  type ScriptReader,
  scannerRangeReader,
  scriptReader,
} from './typescript-peer.js';

/** The same files `strings` reads, because it is the same parser answering. */
export const COMMENTS_EXTENSIONS = SCRIPT_EXTENSIONS;

/** Reads the comment ranges out of one piece of source. */
export type CommentReader = ScriptReader;

/**
 * TypeScript 5 and 6, through the syntax tree.
 *
 * A comment is trivia rather than a node, so it cannot be collected by walking children the
 * way a literal is. It is instead attached to the token that follows it, and every comment
 * in a file is in the gap in front of exactly one token, the end-of-file token included. So
 * the walk descends to the leaves and asks TypeScript itself what is in the gap.
 *
 * Both the leading and the trailing reader are asked, from the same position. They partition
 * the gap rather than overlapping: the trailing one stops at the first line break and the
 * leading one only starts collecting after one, which is how `const a = 1; // note` is found
 * at all.
 *
 * JSX text is the one leaf that is skipped, and it has to be. It carries no trivia, so
 * asking what is in front of it reads its own text: the `// hello` of `<p>// hello</p>` is
 * prose a page renders, not a comment. Skipping the token is enough, because the gap in
 * front of every other token stops where the JSX text token starts.
 *
 * Exported for the equivalence test, which runs both readers over the same corpus and
 * requires identical ranges.
 */
export function astCommentReader(ts: typeof typescript): CommentReader {
  return (source, language, fileName) => {
    const sourceFile = parseScript(ts, source, language, fileName);

    const ranges: Range[] = [];
    // A zero-width node, such as the empty modifier list of a bare `class C {}`, sits at the
    // same position as the token after it, so both are asked about the same gap and both are
    // told the same thing. Positions are unique per comment, so they are what dedupes.
    const seen = new Set<number>();
    const collect = (found: readonly typescript.CommentRange[] | undefined): void => {
      for (const range of found ?? []) {
        if (seen.has(range.pos)) continue;
        seen.add(range.pos);
        ranges.push({ start: range.pos, end: range.end });
      }
    };

    const visit = (node: typescript.Node): void => {
      if (node.kind === ts.SyntaxKind.JsxText) return;
      const children = node.getChildren(sourceFile);
      if (children.length > 0) {
        for (const child of children) visit(child);
        return;
      }
      const gap = node.getFullStart();
      collect(ts.getTrailingCommentRanges(source, gap));
      collect(ts.getLeadingCommentRanges(source, gap));
    };
    visit(sourceFile);

    // Source order, which the walk does not quite give: a gap's trailing comments are read
    // before its leading ones, and those are the two halves of one gap in the wrong order.
    ranges.sort((a, b) => a.start - b.start);
    return ranges;
  };
}

/** Exported for the same reason as `astCommentReader`. */
export function scannerCommentReader(ast: ScanningApi): CommentReader {
  return scannerRangeReader(ast, commentRanges);
}

/** See `loadLiteralReader`, which picks its reader the same way. */
export const loadCommentReader = scriptReader<CommentReader>({
  fromParser: astCommentReader,
  fromScanner: scannerCommentReader,
});

export const commentsExtractor: Extractor = async (text, file) => {
  const language = languageForFile(file);
  if (language === undefined) return [];
  const read = await loadCommentReader('comments');

  // The enclosing sentence rather than the comment, which is the unit `raw` gives over the
  // same text. Comment prose is hard-wrapped like any other, and a run of `//` lines is a
  // separate comment per line, so the comment is the line by another name for exactly the
  // case the sentence exists to handle.
  return read(text, language, file, 'comments').map((range) => ({
    start: range.start,
    end: range.end,
    container: 'sentence' as const,
  }));
};
