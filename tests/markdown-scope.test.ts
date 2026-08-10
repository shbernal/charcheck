import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { scanText } from '../src/scan.js';
import { scopeSupportsFile } from '../src/scope/index.js';
import { markdownExtractor } from '../src/scope/markdown.js';
import { MissingPeerDependencyError } from '../src/scope/missing-peer.js';
import { rule } from './helpers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const markdownRule = rule({ id: 'no-em-dash', scope: 'markdown' });

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), 'utf8');
}

/** The lines, so a failure says where it went wrong rather than just how many. */
function lines(findings: { line: number }[]): number[] {
  return findings.map((finding) => finding.line);
}

describe('the markdown scope', () => {
  it('reaches prose and nothing else', async () => {
    const text = await fixture('prose.md');
    const findings = await scanText(text, 'prose.md', [markdownRule]);

    // Both frontmatter lines, the heading, three on the paragraph (its prose, the link text
    // and the link title, but not the destination), two on the image (alt text and title, not
    // the source), the prose either side of an inline code span, the block quote, the list
    // item, the prose around an autolink, a reference definition's title, and the second half
    // of a hard-wrapped sentence. Not: either fenced block, the indented block, the inline
    // span, the HTML block, any link target, the autolink.
    expect(lines(findings)).toEqual([2, 3, 6, 8, 8, 8, 10, 10, 12, 24, 26, 30, 32, 35]);
    for (const finding of findings) {
      expect(text[finding.offset], `offset of the finding on line ${finding.line}`).toBe(EM_DASH);
    }
  });

  it('exempts code in all four of its spellings', async () => {
    const text = await fixture('prose.md');
    const flagged = new Set(lines(await scanText(text, 'prose.md', [markdownRule])));
    expect(flagged.has(15)).toBe(false); // fenced
    expect(flagged.has(19)).toBe(false); // inside a wider fence that ``` does not close
    expect(flagged.has(22)).toBe(false); // indented
    // Line 12 holds an inline span and prose. The prose is found, the span is not.
    expect(lines(await scanText(text, 'prose.md', [markdownRule])).filter((l) => l === 12)).toEqual(
      [12],
    );
  });

  it('closes a fence only on one at least as long, which is why it takes a parser', async () => {
    // The hand-rolled fence skipping in `src/suppress.ts` toggles on any fence and would end
    // this block at the inner ```, exposing the rest as prose. That asymmetry is deliberate
    // there and would be a false positive here.
    const source = `\`\`\`\`\nouter ${EM_DASH}\n\`\`\`\nstill code ${EM_DASH}\n\`\`\`\`\n`;
    expect(await scanText(source, 'a.md', [markdownRule])).toEqual([]);
  });

  it('exempts a fence language tag and its meta', async () => {
    const source = `\`\`\`js${EM_DASH} title="meta ${EM_DASH}"\ncode\n\`\`\`\n`;
    expect(await scanText(source, 'a.md', [markdownRule])).toEqual([]);
  });

  it('exempts link targets and autolinks but reads titles and alt text', async () => {
    const text = await fixture('prose.md');
    const findings = await scanText(text, 'prose.md', [markdownRule]);
    const matched = (line: number): string[] =>
      findings
        .filter((finding) => finding.line === line)
        .map((finding) => text.slice(finding.offset - 6, finding.offset));

    // A title and label text are rendered, a destination is not.
    expect(matched(8)).toEqual(['prose ', ' text ', 'title ']);
    expect(matched(10)).toEqual([' text ', 'title ']);
    // A reference definition contributes its title only, never its label or destination.
    expect(matched(32)).toEqual(['title ']);
  });

  it('covers the whole frontmatter block rather than guessing per key', async () => {
    const text = await fixture('prose.md');
    const findings = await scanText(text, 'prose.md', [markdownRule]);
    // Line 3 is the second key. Covering only the first line would miss it.
    expect(lines(findings).filter((line) => line <= 4)).toEqual([2, 3]);
  });

  it('does not let a fence inside frontmatter silence the document', async () => {
    // Left to micromark, the backticks would open a code span or block and swallow the prose
    // below. Frontmatter is split off before parsing precisely so it cannot.
    const source = `---\ndescription: run \`npm i\`\n---\n\nprose ${EM_DASH} here\n`;
    expect(lines(await scanText(source, 'a.md', [markdownRule]))).toEqual([5]);
  });

  it('treats an unclosed opening delimiter as a thematic break, not frontmatter', async () => {
    const source = `---\n\nprose ${EM_DASH} here\n`;
    expect(lines(await scanText(source, 'a.md', [markdownRule]))).toEqual([3]);
  });

  it('joins a hard wrap into one chunk, and never across a paragraph break', async () => {
    const wrapped = 'one line\ntwo line\n';
    const [chunk, ...rest] = await markdownExtractor(wrapped, 'a.md');
    expect(rest).toEqual([]);
    expect(wrapped.slice(chunk!.start, chunk!.end)).toBe('one line\ntwo line');

    const split = 'one para\n\ntwo para\n';
    const chunks = await markdownExtractor(split, 'a.md');
    expect(chunks.map((c) => split.slice(c.start, c.end))).toEqual(['one para', 'two para']);
  });

  it('joins a wrap that carries a block quote prefix', async () => {
    const source = `> wrapped prose ending in a\n> continuation ${EM_DASH} line\n`;
    const [chunk, ...rest] = await markdownExtractor(source, 'a.md');
    expect(rest).toEqual([]);
    expect(source.slice(chunk!.start, chunk!.end)).toContain('\n> ');
  });

  it('gives a fix the enclosing sentence, as raw does for hard-wrapped prose', async () => {
    const containers: string[] = [];
    const source = `First one. Second ${EM_DASH} here. Third one.\n`;
    await scanText(source, 'a.md', [
      rule({
        id: 'contextual',
        scope: 'markdown',
        fix: (context) => {
          containers.push(context.container);
          expect(context.scope).toBe('markdown');
          return '-';
        },
      }),
    ]);
    expect(containers).toEqual([`Second ${EM_DASH} here.`]);
  });

  it('handles CRLF files', async () => {
    const text = (await fixture('prose.md')).replace(/\n/g, '\r\n');
    const findings = await scanText(text, 'prose.md', [markdownRule]);
    expect(lines(findings)).toEqual([2, 3, 6, 8, 8, 8, 10, 10, 12, 24, 26, 30, 32, 35]);
    for (const finding of findings) {
      expect(text[finding.offset], `offset of the finding on line ${finding.line}`).toBe(EM_DASH);
    }
  });

  it('fixes only prose and leaves code byte-identical', async () => {
    const text = await fixture('prose.md');
    const findings = await scanText(text, 'prose.md', [
      rule({ id: 'fixer', scope: 'markdown', fix: '-' }),
    ]);
    const fixed = applyFixes(text, findings);

    expect(fixed).toContain(`const fenced = "code ${EM_DASH}";`);
    expect(fixed).toContain(`https://x.example/a${EM_DASH}b`);
    expect(fixed).toContain('Plain prose -,');
    // A second pass has nothing left to do, so the fix converges in one.
    expect(await scanText(fixed, 'prose.md', [markdownRule])).toEqual([]);
  });

  it('is limited to .md and .markdown, with .mdx a separate surface', async () => {
    expect(scopeSupportsFile('markdown', 'a.md')).toBe(true);
    expect(scopeSupportsFile('markdown', 'a.markdown')).toBe(true);
    // MDX needs the JSX reader and inherits its TypeScript 7 limitation.
    expect(scopeSupportsFile('markdown', 'a.mdx')).toBe(false);
    expect(scopeSupportsFile('markdown', 'a.txt')).toBe(false);
    expect(await scanText(`prose ${EM_DASH}\n`, 'a.mdx', [markdownRule])).toEqual([]);
  });

  it('names the parser package when it is missing', () => {
    const error = new MissingPeerDependencyError('micromark', 'markdown');
    expect(error.message).toContain('micromark');
    expect(error.message).toContain('markdown');
    expect(error.packageName).toBe('micromark');
  });
});
