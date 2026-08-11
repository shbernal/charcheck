import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { scanText } from '../src/scan.js';
import { scopeSupportsFile } from '../src/scope/index.js';
import { MissingPeerDependencyError } from '../src/scope/missing-peer.js';
import type { Scope } from '../src/types.js';
import { rule } from './helpers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Named, because the helper fills in `chars` and a `pattern` rule has to skip it. */
const scope: Scope = 'html';
const htmlRule = rule({ id: 'no-em-dash', scope });

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), 'utf8');
}

/** The lines, so a failure says where it went wrong rather than just how many. */
function lines(findings: { line: number }[]): number[] {
  return findings.map((finding) => finding.line);
}

describe('the html scope', () => {
  it('reaches rendered text and nothing else', async () => {
    const text = await fixture('full.html');
    const findings = await scanText(text, 'full.html', [htmlRule]);

    // title text, meta content, title attribute and text node, a hard wrap, alt quoted and
    // unquoted, text after a code element, textarea, template, noscript, link text, script
    // literal. Not: the comment, the style block, class and data attributes, content-x,
    // the code and pre elements, the href, the script comment, the JSON script.
    expect(lines(findings)).toEqual([4, 5, 14, 14, 16, 17, 18, 19, 21, 22, 23, 24, 27]);
    for (const finding of findings) {
      expect(text[finding.offset], `offset of the finding on line ${finding.line}`).toBe(EM_DASH);
    }
  });

  it('exempts a comment, a style block, and the code elements', async () => {
    const text = await fixture('full.html');
    const flagged = new Set(lines(await scanText(text, 'full.html', [htmlRule])));
    expect(flagged.has(8)).toBe(false); // style comment
    expect(flagged.has(9)).toBe(false); // style declaration
    expect(flagged.has(13)).toBe(false); // html comment
    expect(flagged.has(20)).toBe(false); // pre element
    expect(flagged.has(26)).toBe(false); // comment inside a script
    expect(flagged.has(30)).toBe(false); // application/ld+json
  });

  it('does not let a merged text node swallow the comment between two runs', async () => {
    // parse5 concatenates adjacent text onto one node and stretches its location over the
    // markup in between, which after </body> puts a comment inside the text span.
    const source = `<body>hello</body><!-- c ${EM_DASH} -->tail\n`;
    expect(await scanText(source, 'a.html', [htmlRule])).toEqual([]);
  });

  it('reads a code element as exempt but the prose either side of it as text', async () => {
    const source = `<p>before ${EM_DASH} <code>in ${EM_DASH} code</code> after ${EM_DASH}</p>`;
    const findings = await scanText(source, 'a.html', [htmlRule]);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.offset).toBe(source.indexOf(EM_DASH));
    expect(findings[1]!.offset).toBe(source.lastIndexOf(EM_DASH));
  });

  it('joins a run split by whitespace, so a pattern spanning a space still matches', async () => {
    // The tokenizer emits whitespace as its own character token, so the chunks either side
    // of the space have to be one region for this to match at all.
    const spanning = { id: 'spanning', pattern: `a ${EM_DASH} b`, include: ['**/*'], scope };
    const source = `<p>a ${EM_DASH} b</p>`;
    expect(await scanText(source, 'a.html', [spanning])).toHaveLength(1);
  });

  it('joins prose across a hard wrap', async () => {
    const spanning = { id: 'spanning', pattern: `a\\s+${EM_DASH}`, include: ['**/*'], scope };
    const source = `<p>ends with a\n  ${EM_DASH} continuation</p>`;
    expect(await scanText(source, 'a.html', [spanning])).toHaveLength(1);
  });

  it('skips attributes that are not on the allowlist, and honours a configured one', async () => {
    const source = `<p class="cls-${EM_DASH}" title="attr ${EM_DASH}">x</p>`;
    const byDefault = await scanText(source, 'a.html', [htmlRule]);
    expect(byDefault).toHaveLength(1);
    expect(byDefault[0]!.offset).toBe(source.indexOf(`attr ${EM_DASH}`) + 5);

    const configured = await scanText(source, 'a.html', [htmlRule], { textAttributes: ['class'] });
    expect(configured).toHaveLength(1);
    expect(configured[0]!.offset).toBe(source.indexOf(`cls-${EM_DASH}`) + 4);
  });

  it('reads an unquoted attribute value', async () => {
    const source = `<img alt=unquoted-${EM_DASH} src="a.png">`;
    const [finding] = await scanText(source, 'a.html', [htmlRule]);
    expect(finding?.offset).toBe(source.indexOf(EM_DASH));
  });

  it('keeps content restricted to a meta tag by default', async () => {
    const onMeta = `<meta name="description" content="meta ${EM_DASH}">`;
    expect(await scanText(onMeta, 'a.html', [htmlRule])).toHaveLength(1);
    const elsewhere = `<div content="not meta ${EM_DASH}"></div>`;
    expect(await scanText(elsewhere, 'a.html', [htmlRule])).toEqual([]);
  });

  it('reads a character reference as the source wrote it', async () => {
    const ampersand = rule({ id: 'no-amp', chars: ['&'], scope: 'html' });
    const findings = await scanText('<p>a &amp; b</p>', 'a.html', [ampersand]);
    // The one the author typed, not a second one from the decoded value.
    expect(findings).toHaveLength(1);
  });

  it('handles CRLF files', async () => {
    const text = await fixture('crlf.html');
    expect(text).toContain('\r\n');
    const findings = await scanText(text, 'crlf.html', [htmlRule]);
    expect(lines(findings)).toEqual([2, 2, 3]);
    for (const finding of findings) expect(text[finding.offset]).toBe(EM_DASH);
  });

  it('handles a fragment with no html, head or body element', async () => {
    const source = `<p>fragment ${EM_DASH}</p>\n`;
    const [finding] = await scanText(source, 'a.html', [htmlRule]);
    expect(finding?.offset).toBe(source.indexOf(EM_DASH));
  });

  it('keeps a foster-parented run at its own offset', async () => {
    const source = `<table>stray ${EM_DASH}<tr><td>cell</td></tr></table>`;
    const [finding] = await scanText(source, 'a.html', [htmlRule]);
    expect(finding?.offset).toBe(source.indexOf(EM_DASH));
  });

  it('fixes only the matched span and leaves the rest byte-identical', async () => {
    const text = await fixture('crlf.html');
    const findings = await scanText(text, 'crlf.html', [
      rule({ id: 'fixer', scope: 'html', fix: '-' }),
    ]);
    const fixed = applyFixes(text, findings);
    expect(fixed).toBe(text.replaceAll(EM_DASH, '-'));
    expect(fixed).toContain('\r\n');
    // The result is still a parseable document with nothing left to find.
    expect(await scanText(fixed, 'crlf.html', [htmlRule])).toEqual([]);
  });

  it('names the parser package when it is missing', () => {
    const error = new MissingPeerDependencyError('parse5', 'html');
    expect(error.message).toContain('parse5');
    expect(error.message).toContain('html');
    expect(error.packageName).toBe('parse5');
  });

  it('is limited to .html and .htm', async () => {
    expect(scopeSupportsFile('html', 'a.html')).toBe(true);
    expect(scopeSupportsFile('html', 'a.htm')).toBe(true);
    expect(scopeSupportsFile('html', 'a.vue')).toBe(false);
    expect(scopeSupportsFile('html', 'a.svelte')).toBe(false);
    expect(await scanText(`<p>text ${EM_DASH}</p>`, 'a.vue', [htmlRule])).toEqual([]);
  });
});
