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

/** 0-based line number containing `offset`. */
function lineIndexAt(index: LineIndex, offset: number): number {
  const { starts } = index;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

export interface Position {
  /** 1-based. */
  line: number;
  /** 1-based, UTF-16 code units. */
  column: number;
}

export function positionAt(index: LineIndex, offset: number): Position {
  const line = lineIndexAt(index, offset);
  return { line: line + 1, column: offset - index.starts[line]! + 1 };
}
