import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { scanText } from '../src/scan.js';
import { MissingPeerDependencyError } from '../src/scope/missing-peer.js';
import { scopeSupportsFile } from '../src/scope/index.js';
import { DEFAULT_TEXT_ATTRIBUTES } from '../src/scope/text-attributes.js';
import { rule } from './helpers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const markupRule = rule({ id: 'no-em-dash', scope: 'markup' });

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), 'utf8');
}

/** The lines, so a failure says where it went wrong rather than just how many. */
function lines(findings: { line: number }[]): number[] {
  return findings.map((finding) => finding.line);
}

describe('the markup scope', () => {
  it('reaches rendered text and nothing else', async () => {
    const text = await fixture('full.vue');
    const findings = await scanText(text, 'full.vue', [markupRule]);

    // Template text, interpolated literal, alt, meta content, bound title,
    // script setup literal, plain script literal. Not: the HTML comment, the class and
    // data attributes, the bound non-text attribute, the code comment, the style block.
    expect(lines(findings)).toEqual([3, 4, 5, 6, 7, 12, 16]);
    for (const finding of findings) {
      expect(text[finding.offset], `offset of the finding on line ${finding.line}`).toBe(EM_DASH);
    }
  });

  it('exempts a template comment and a style block', async () => {
    const text = await fixture('full.vue');
    const findings = await scanText(text, 'full.vue', [markupRule]);
    const flagged = new Set(findings.map((finding) => finding.line));
    expect(flagged.has(2)).toBe(false); // html comment
    expect(flagged.has(11)).toBe(false); // code comment
    expect(flagged.has(20)).toBe(false); // style block
  });

  it('skips attributes that are not on the allowlist', async () => {
    const text = await fixture('full.vue');
    const findings = await scanText(text, 'full.vue', [markupRule]);
    const onLine5 = findings.filter((finding) => finding.line === 5);
    expect(onLine5).toHaveLength(1);
    // The alt value, not the class or the data attribute.
    expect(text.slice(onLine5[0]!.offset - 5, onLine5[0]!.offset)).toBe('"alt ');
  });

  it('honours a configured attribute allowlist', async () => {
    const text = await fixture('full.vue');
    const findings = await scanText(text, 'full.vue', [markupRule], {
      textAttributes: ['data-x'],
    });
    const onLine5 = findings.filter((finding) => finding.line === 5);
    expect(onLine5).toHaveLength(1);
    expect(text.slice(onLine5[0]!.offset - 3, onLine5[0]!.offset)).toBe('"d-');
  });

  it('keeps content restricted to a meta tag by default', async () => {
    expect(DEFAULT_TEXT_ATTRIBUTES).not.toContain('content');
    const source = `<template>\n  <div content="not meta ${EM_DASH}" />\n</template>\n`;
    expect(await scanText(source, 'a.vue', [markupRule])).toEqual([]);
  });

  it('reports file-relative positions after a long preamble', async () => {
    const text = await fixture('offsets.vue');
    const [finding] = await scanText(text, 'offsets.vue', [markupRule]);
    expect(finding).toMatchObject({ line: 11 });
    expect(text[finding!.offset]).toBe(EM_DASH);
  });

  it('handles CRLF files', async () => {
    const text = await fixture('crlf.vue');
    expect(text).toContain('\r\n');
    const [finding] = await scanText(text, 'crlf.vue', [markupRule]);
    expect(finding).toMatchObject({ line: 2 });
    expect(text[finding!.offset]).toBe(EM_DASH);
  });

  it('handles a component with no script, and one with no template', async () => {
    for (const name of ['no-script.vue', 'no-template.vue']) {
      const text = await fixture(name);
      const findings = await scanText(text, name, [markupRule]);
      expect(findings, name).toHaveLength(1);
      expect(text[findings[0]!.offset], name).toBe(EM_DASH);
    }
  });

  it('fixes only the matched span and leaves the rest byte-identical', async () => {
    const text = await fixture('crlf.vue');
    const findings = await scanText(text, 'crlf.vue', [
      rule({ id: 'fixer', scope: 'markup', fix: '-' }),
    ]);
    const fixed = applyFixes(text, findings);
    expect(fixed).toBe(text.replace(EM_DASH, '-'));
    expect(fixed).toContain('\r\n');
    // The result is still a parseable component.
    expect(await scanText(fixed, 'crlf.vue', [markupRule])).toEqual([]);
  });

  it('names the parser package when it is missing', () => {
    const error = new MissingPeerDependencyError('@vue/compiler-sfc', 'markup');
    expect(error.message).toContain('@vue/compiler-sfc');
    expect(error.message).toContain('markup');
    expect(error.packageName).toBe('@vue/compiler-sfc');
  });

  it('is limited to .vue in this version', async () => {
    expect(scopeSupportsFile('markup', 'a.vue')).toBe(true);
    expect(scopeSupportsFile('markup', 'a.html')).toBe(false);
    expect(scopeSupportsFile('markup', 'a.svelte')).toBe(false);
    expect(await scanText(`<p>text ${EM_DASH}</p>`, 'a.html', [markupRule])).toEqual([]);
  });
});
