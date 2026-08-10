/**
 * Sentence boundaries, for the one job that needs them: giving a fix function enough text
 * to decide with.
 *
 * The `raw` scope used to hand a fix the enclosing *line*, and in a repository whose prose
 * is hard-wrapped that is the wrong unit by a wide margin. A dash pair straddling a wrap
 * looks like two lone dashes, one per line, and `clauseSeparator` turns both into colons:
 *
 *     The fourth state — approximated, output that looks about right but has no way
 *     back — is what the charter rules out.
 *
 * becomes `The fourth state: … back: is what`, which is not a sentence. Measured over one
 * real site, the line as the unit got 36% of its replacements wrong, and two thirds of
 * those were this and its close relative, a colon earlier in the sentence but not on the
 * line.
 *
 * The paragraph is not the unit either, and that is worth stating because it is the
 * obvious next guess. Consecutive list items are one paragraph, no blank line divides
 * them, and each holding a dash of its own is not an aside split across a wrap.
 *
 * This is a heuristic and is only ever read by a fix, never used to place a finding. An
 * abbreviation ends a sentence early; the cost is a comma where a colon would have read
 * better, in a diff the tool already tells you to read.
 */

/** Terminal punctuation, any closing quote or bracket after it, then whitespace. */
const TERMINATOR = /[.!?;]["'`)\]]*\s/g;

/**
 * A line that begins a block rather than continuing the prose above it: a list item, a
 * heading, a block quote, a table row, or an HTML element. Its own continuation lines are
 * part of it, so this only opens a sentence. Headings are closed by the rule below.
 */
const BLOCK_START = /^[^\S\n]*(?:<|(?:[-*+>|]|\d+[.)]|#{1,6})[^\S\n])/;

/** A heading occupies exactly one line, so whatever follows it starts afresh. */
const HEADING = /^[^\S\n]*#{1,6}[^\S\n]/;

const BLANK = /^[^\S\n]*$/;

export interface SentenceIndex {
  /** Absolute offset of the first character of each sentence, ascending. */
  starts: number[];
  text: string;
}

export function buildSentenceIndex(text: string): SentenceIndex {
  const starts = [0];
  const push = (offset: number): void => {
    if (offset > starts[starts.length - 1]! && offset < text.length) starts.push(offset);
  };

  let lineStart = 0;
  let previousWasHeading = false;

  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);

    if (BLANK.test(line)) {
      // A blank line ends what came before it without belonging to what comes next.
      push(lineEnd + 1);
      previousWasHeading = false;
    } else {
      if (previousWasHeading || BLOCK_START.test(line)) push(lineStart);
      previousWasHeading = HEADING.test(line);

      TERMINATOR.lastIndex = 0;
      for (let m = TERMINATOR.exec(line); m !== null; m = TERMINATOR.exec(line)) {
        push(lineStart + m.index + m[0].length);
        // The whitespace the terminator consumed may start the next sentence, so the
        // search resumes inside the match rather than after it.
        TERMINATOR.lastIndex = m.index + 1;
      }
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }

  return { starts, text };
}

export interface Sentence {
  /** Trimmed of the whitespace around it, so a fix never has to. */
  text: string;
  /** Absolute offset of `text[0]`, so a caller can locate its match inside it. */
  start: number;
}

/** The sentence containing `offset`. */
export function sentenceAt(index: SentenceIndex, offset: number): Sentence {
  const { starts, text } = index;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  const from = starts[low]!;
  const to = starts[low + 1] ?? text.length;
  const raw = text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  return { text: raw.trim(), start: from + lead };
}
