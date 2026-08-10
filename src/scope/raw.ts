import type { Chunk, Extractor } from '../types.js';

/** The whole file is one chunk, and a fix sees the enclosing line as its context. */
export const rawExtractor: Extractor = (text: string): Promise<Chunk[]> =>
  Promise.resolve(text.length === 0 ? [] : [{ start: 0, end: text.length, container: 'line' }]);
