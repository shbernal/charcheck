import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { scanText } from '../src/scan.js';
import { scopeSupportsFile } from '../src/scope/index.js';
import { rule } from './helpers.js';

const commentsRule = rule({ id: 'no-em-dash', scope: 'comments' });

describe('the comments scope', () => {
  it('flags a line comment', async () => {
    const source = `// a note ${EM_DASH} here\nconst ok = 'clean';\n`;
    const [finding] = await scanText(source, 'a.ts', [commentsRule]);
    expect(finding).toMatchObject({ line: 1, column: 11 });
  });

  it('flags a block comment and a doc comment', async () => {
    const source = [
      `/* block ${EM_DASH} one */`,
      `/**`,
      ` * doc ${EM_DASH} two`,
      ` */`,
      `const ok = 'clean';`,
    ].join('\n');
    const findings = await scanText(source, 'a.ts', [commentsRule]);
    expect(findings.map((f) => f.line)).toEqual([1, 3]);
  });

  it('exempts string and template literals, which are the strings scope', async () => {
    const source = [
      `const a = "text ${EM_DASH} here";`,
      'const b = `tpl ' + EM_DASH + '`;',
      `// only this ${EM_DASH} one counts`,
    ].join('\n');
    const findings = await scanText(source, 'a.ts', [commentsRule]);
    expect(findings.map((f) => f.line)).toEqual([3]);
  });

  it('is the complement of strings, so the two together cover the authored text', async () => {
    const source = `// note ${EM_DASH}\nconst a = "text ${EM_DASH}";\nconst dash${EM_DASH}less = 1;\n`;
    const both = await scanText(source, 'a.ts', [
      commentsRule,
      rule({ id: 'in-strings', scope: 'strings' }),
    ]);
    expect(both.map((f) => f.line)).toEqual([1, 2]);
  });

  it('reads the delimiters, so a marker and its reason are inside the region', async () => {
    const source = `// charcheck-disable-line other-rule, because reasons\n`;
    const findings = await scanText(source, 'a.ts', [
      { id: 'slashes', pattern: '//', scope: 'comments', include: ['**/*'] },
    ]);
    expect(findings).toMatchObject([{ line: 1, column: 1 }]);
  });

  it('does not read a comment opener that is not one', async () => {
    // Each of these holds `//` or `/*` where no comment starts, and only a lexer knows it:
    // a scan for the delimiter alone would report every one of them.
    for (const source of [
      `const url = "http://${EM_DASH}.example";`,
      'const t = `a // ' + EM_DASH + ' b`;',
      `const re = /a\\/\\/${EM_DASH}b/;`,
      `const t2 = "/* ${EM_DASH} */";`,
    ]) {
      expect(await scanText(source, 'a.ts', [commentsRule]), source).toEqual([]);
    }
  });

  it('reads a comment that follows a regular expression, which divides in other positions', async () => {
    const source = `const re = /["']/g; // after ${EM_DASH} it\n`;
    expect(await scanText(source, 'a.ts', [commentsRule])).toHaveLength(1);
  });

  it('gives the fix the enclosing sentence, as raw does over the same text', async () => {
    const seen: string[] = [];
    const source = `// One sentence. Another ${EM_DASH} one.\n`;
    await scanText(source, 'a.ts', [
      rule({
        id: 'context',
        scope: 'comments',
        fix: (ctx) => {
          seen.push(ctx.container);
          return '';
        },
      }),
    ]);
    expect(seen).toEqual([`Another ${EM_DASH} one.`]);
  });

  it('rewrites only the comment when fixing', async () => {
    const source = `// fix ${EM_DASH} me\nconst s = "keep ${EM_DASH} me";\n`;
    const findings = await scanText(source, 'a.ts', [
      rule({ id: 'fixer', scope: 'comments', fix: '-' }),
    ]);
    expect(applyFixes(source, findings)).toBe(`// fix - me\nconst s = "keep ${EM_DASH} me";\n`);
  });

  it('parses tsx, mts and cjs', async () => {
    for (const file of ['a.tsx', 'a.mts', 'a.cjs']) {
      const findings = await scanText(`// x ${EM_DASH}\n`, file, [commentsRule]);
      expect(findings, file).toHaveLength(1);
    }
  });

  it('reads a comment inside a jsx expression and not the text beside it', async () => {
    const source = `const a = <p>// not ${EM_DASH} a comment{/* real ${EM_DASH} one */}</p>;\n`;
    const findings = await scanText(source, 'a.tsx', [commentsRule]);
    expect(findings).toHaveLength(1);
    // The one inside the comment, not the one in the text the element renders.
    expect(findings[0]?.offset).toBe(source.indexOf(EM_DASH, source.indexOf('/* real')));
  });

  it('finds nothing in a file it cannot parse', async () => {
    expect(await scanText(`prose ${EM_DASH} here`, 'a.md', [commentsRule])).toEqual([]);
    expect(scopeSupportsFile('comments', 'a.md')).toBe(false);
    expect(scopeSupportsFile('comments', 'a.ts')).toBe(true);
  });
});
