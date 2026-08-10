import { describe, expect, it } from 'vitest';

import { buildSentenceIndex, sentenceAt } from '../src/sentence.js';

/** The sentence around the first `|`, with the marker removed first. */
function around(marked: string): string {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  return sentenceAt(buildSentenceIndex(text), at).text;
}

describe('sentenceAt', () => {
  it('ends a sentence at terminal punctuation followed by space', () => {
    expect(around('One thing. Two |things. Three things.')).toBe('Two things.');
    expect(around('Is it? Yes |it is! No.')).toBe('Yes it is!');
    expect(around('A clause; another |clause; a third.')).toBe('another clause;');
  });

  it('keeps a hard-wrapped sentence whole', () => {
    expect(around('A sentence that runs\nacross |two lines. Another.')).toBe(
      'A sentence that runs\nacross two lines.',
    );
  });

  it('does not split on a decimal point, which has no space after it', () => {
    expect(around('Version 5.9.3 is |supported.')).toBe('Version 5.9.3 is supported.');
  });

  it('does not split inside a path or a package name', () => {
    expect(around('Read src/scope/raw.ts and |judge for yourself.')).toBe(
      'Read src/scope/raw.ts and judge for yourself.',
    );
  });

  it('ends a sentence at a blank line even with no punctuation', () => {
    expect(around('A heading line\n\nThe |body text')).toBe('The body text');
  });

  /**
   * Adjacent list items hold one dash each and are not an aside split across a wrap. A
   * paragraph-sized window says they are, which is why the unit is the sentence.
   */
  it('treats each list item as its own sentence', () => {
    const text = '- Modeled, the IR represents it\n- |Carried, the IR does not\n- Warned, neither';
    expect(around(text)).toBe('- Carried, the IR does not');
  });

  it('keeps a list item that wraps onto a continuation line whole', () => {
    expect(around('- Modeled, the IR\n  represents |it\n- Carried, it does not')).toBe(
      '- Modeled, the IR\n  represents it',
    );
  });

  it('treats a heading and the paragraph under it as separate', () => {
    expect(around('Text above\n## A heading\nThe |body')).toBe('The body');
    expect(around('Text above\n## A |heading\nThe body')).toBe('## A heading');
  });

  it('starts a sentence at a block element rather than continuing the prose above', () => {
    expect(around('A line of prose\n<div class="x">\nInside |the block')).toBe(
      '<div class="x">\nInside the block',
    );
  });

  it('handles an offset in the first and the last sentence', () => {
    const text = 'First one. Second one. Third one.';
    const index = buildSentenceIndex(text);
    expect(sentenceAt(index, 0).text).toBe('First one.');
    expect(sentenceAt(index, text.length - 1).text).toBe('Third one.');
  });

  it('reports a start that lands on the first character of the trimmed text', () => {
    const text = 'One.   Two words here.';
    const index = buildSentenceIndex(text);
    const found = sentenceAt(index, text.indexOf('words'));
    expect(found.text).toBe('Two words here.');
    expect(text.slice(found.start, found.start + found.text.length)).toBe(found.text);
  });

  it('treats a text with no boundary at all as one sentence', () => {
    expect(around('no punctuation |anywhere at all')).toBe('no punctuation anywhere at all');
  });

  it('survives an empty text', () => {
    expect(sentenceAt(buildSentenceIndex(''), 0).text).toBe('');
  });
});
