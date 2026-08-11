import { floorIndex } from './search.js';

/**
 * One line index per file, binary-searched per match. A file with many findings must stay
 * linear in its size, not quadratic.
 */
export interface LineIndex {
  /** Absolute offset of the first character of each line. */
  starts: number[];
}

export function buildLineIndex(text: string): LineIndex {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return { starts };
}

export interface Position {
  /** 1-based. */
  line: number;
  /** 1-based, UTF-16 code units. */
  column: number;
}

export function positionAt(index: LineIndex, offset: number): Position {
  const line = floorIndex(index.starts, offset);
  return { line: line + 1, column: offset - index.starts[line]! + 1 };
}
