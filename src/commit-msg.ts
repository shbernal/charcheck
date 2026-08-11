/**
 * Preparing a commit message for scanning.
 *
 * Everything git adds to the file is noise: comment lines, and under `commit.verbose` the
 * entire diff below the scissors. Scanning that would report banned characters in the code
 * being committed rather than in the message, which is both wrong and baffling.
 */

import { escapeRegExp } from './regex.js';

/** Git generates these itself, so failing them blames the developer for git's wording. */
const GENERATED_SUBJECT = /^(Merge|Revert|fixup!|squash!|amend!)/;

export interface PreparedMessage {
  /**
   * The message with everything ignorable blanked out, character for character. Positions
   * in it are positions in the original file, which is what lets an error point at the
   * line the developer actually typed.
   */
  masked: string;
  /** True when the message is git's own and should not be checked at all. */
  generated: boolean;
}

/** Replace a span with spaces, keeping every line break so offsets never move. */
function blank(text: string): string {
  return text.replaceAll(/[^\r\n]/g, ' ');
}

export function prepareCommitMessage(text: string, comment: string): PreparedMessage {
  const lines = text.split('\n');

  const subject = lines.find((line) => line.trim().length > 0 && !line.startsWith(comment));
  if (subject !== undefined && GENERATED_SUBJECT.test(subject.trim())) {
    return { masked: blank(text), generated: true };
  }

  const scissors = new RegExp(`^${escapeRegExp(comment)} -{4,} >8 -{4,}`);
  let afterScissors = false;

  const masked = lines
    .map((line) => {
      if (afterScissors) return blank(line);
      if (scissors.test(line)) {
        afterScissors = true;
        return blank(line);
      }
      return line.startsWith(comment) ? blank(line) : line;
    })
    .join('\n');

  return { masked, generated: false };
}
