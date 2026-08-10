import { describe, expect, it } from 'vitest';

import { BYTE_ORDER_MARK, EM_DASH, EN_DASH, HORIZONTAL_BAR } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { RuleError, compileRule } from '../src/rule.js';
import { looksBinary, scanText } from '../src/scan.js';
import { emDashRule, rule } from './helpers.js';

const NUL = String.fromCharCode(0);

describe('rule compilation', () => {
  it('rejects a rule with both chars and pattern', () => {
    expect(() => compileRule({ id: 'both', chars: [EM_DASH], pattern: 'x', include: [] })).toThrow(
      RuleError,
    );
  });

  it('rejects a rule with neither', () => {
    expect(() => compileRule({ id: 'neither', include: [] })).toThrow(RuleError);
  });

  it('matches the longest alternative first', async () => {
    const doubled = EM_DASH + EM_DASH;
    const findings = await scanText(
      `a ${doubled} b`,
      'a.md',
      [rule({ id: 'dashes', chars: [EM_DASH, doubled] })],
      { assumeText: true },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.match).toBe(doubled);
  });

  it('escapes regex metacharacters in chars', async () => {
    const findings = await scanText('a.b', 'a.md', [rule({ id: 'dot', chars: ['.'] })], {
      assumeText: true,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.column).toBe(2);
  });
});

describe('positions', () => {
  it('reports 1-based line and column', async () => {
    const text = `first\nsecond ${EM_DASH} here\n`;
    const [finding] = await scanText(text, 'a.md', [emDashRule], { assumeText: true });
    expect(finding).toMatchObject({ line: 2, column: 8, endColumn: 9 });
    expect(text[finding!.offset]).toBe(EM_DASH);
  });

  it('is correct across CRLF line endings', async () => {
    const text = `first\r\nsecond\r\nthird ${EM_DASH}\r\n`;
    const [finding] = await scanText(text, 'a.md', [emDashRule], { assumeText: true });
    expect(finding).toMatchObject({ line: 3, column: 7 });
  });

  it('counts UTF-16 code units, so an astral character takes two columns', async () => {
    // A rocket is one code point but two code units; editors count the units.
    const text = `x\u{1F680}${EM_DASH}`;
    const [finding] = await scanText(text, 'a.md', [emDashRule], { assumeText: true });
    expect(finding!.column).toBe(4);
  });

  it('ignores a byte order mark when computing the first column', async () => {
    const text = `${BYTE_ORDER_MARK}${EM_DASH} start`;
    const [finding] = await scanText(text, 'a.md', [emDashRule], { assumeText: true });
    expect(finding).toMatchObject({ line: 1, column: 1, offset: 0 });
  });
});

describe('degenerate files', () => {
  it('returns nothing for an empty file', async () => {
    expect(await scanText('', 'a.md', [emDashRule], { assumeText: true })).toEqual([]);
  });

  it('handles a file with no trailing newline', async () => {
    const [finding] = await scanText(`only ${EM_DASH}`, 'a.md', [emDashRule], {
      assumeText: true,
    });
    expect(finding).toMatchObject({ line: 1, column: 6 });
  });

  it('handles one very long line', async () => {
    const text = `${'x'.repeat(50_000)}${EM_DASH}`;
    const [finding] = await scanText(text, 'a.md', [emDashRule], { assumeText: true });
    expect(finding).toMatchObject({ line: 1, column: 50_001 });
  });

  it('skips binary content', async () => {
    expect(looksBinary(`abc${NUL}def`)).toBe(true);
    const findings = await scanText(`${EM_DASH}${NUL}binary`, 'a.png', [emDashRule]);
    expect(findings).toEqual([]);
  });
});

describe('multiple rules', () => {
  it('lets two rules report the same character', async () => {
    const findings = await scanText(
      `a ${EM_DASH} b`,
      'a.md',
      [rule({ id: 'first' }), rule({ id: 'second' })],
      { assumeText: true },
    );
    expect(findings.map((f) => f.ruleId)).toEqual(['first', 'second']);
  });

  it('sorts findings by offset', async () => {
    const text = `${EN_DASH} ${EM_DASH}`;
    const findings = await scanText(
      text,
      'a.md',
      [rule({ id: 'em' }), rule({ id: 'en', chars: [EN_DASH] })],
      { assumeText: true },
    );
    expect(findings.map((f) => f.ruleId)).toEqual(['en', 'em']);
  });

  it('carries severity and a default message naming the code point', async () => {
    const [finding] = await scanText(`${HORIZONTAL_BAR}`, 'a.md', [
      rule({ id: 'bar', chars: [HORIZONTAL_BAR], severity: 'warn' }),
    ]);
    expect(finding!.severity).toBe('warn');
    expect(finding!.message).toContain('U+2015');
  });
});

describe('suppressions', () => {
  it('suppresses the next line, in any comment syntax', async () => {
    const text = [
      `<!-- charcheck-disable-next-line -->`,
      `hidden ${EM_DASH}`,
      `shown ${EM_DASH}`,
    ].join('\n');
    const findings = await scanText(text, 'a.md', [emDashRule], { assumeText: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(3);
  });

  it('suppresses its own line', async () => {
    const text = `code ${EM_DASH} // charcheck-disable-line`;
    expect(await scanText(text, 'a.ts', [emDashRule], { assumeText: true })).toEqual([]);
  });

  it('suppresses only the named rule', async () => {
    const text = `// charcheck-disable-next-line no-em-dash\nvalue ${EM_DASH}`;
    const findings = await scanText(text, 'a.ts', [emDashRule, rule({ id: 'other' })], {
      assumeText: true,
    });
    expect(findings.map((f) => f.ruleId)).toEqual(['other']);
  });

  it('suppresses a whole file', async () => {
    const text = `# charcheck-disable-file\na ${EM_DASH}\nb ${EM_DASH}`;
    expect(await scanText(text, 'a.yml', [emDashRule], { assumeText: true })).toEqual([]);
  });

  it('ignores a marker inside a fenced Markdown block, so documenting it is safe', async () => {
    // Found by running this tool over its own README: the page explaining the syntax
    // suppressed itself and reported clean forever.
    const text = [
      '# Suppressions',
      '',
      '```',
      'charcheck-disable-file',
      '```',
      '',
      `prose ${EM_DASH} here`,
    ].join('\n');
    const findings = await scanText(text, 'README.md', [emDashRule], { assumeText: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(7);
  });

  it('still honours a marker outside a fence in Markdown', async () => {
    const text = `<!-- charcheck-disable-file -->\nprose ${EM_DASH} here`;
    expect(await scanText(text, 'README.md', [emDashRule], { assumeText: true })).toEqual([]);
  });

  it('honours a marker in a fence-shaped line in a non-Markdown file', async () => {
    const text = `# charcheck-disable-file\nvalue ${EM_DASH}`;
    expect(await scanText(text, 'a.yml', [emDashRule], { assumeText: true })).toEqual([]);
  });

  it('does not swallow an HTML comment terminator as a rule id', async () => {
    const text = `<!-- charcheck-disable-next-line no-em-dash -->\nvalue ${EM_DASH}`;
    expect(await scanText(text, 'a.md', [emDashRule], { assumeText: true })).toEqual([]);
  });
});

describe('fixes', () => {
  const fixed = rule({ id: 'to-hyphen', fix: '-' });

  it('reports a rule without a fix as not fixable', async () => {
    const [finding] = await scanText(`a ${EM_DASH}`, 'a.md', [emDashRule], { assumeText: true });
    expect(finding!.fixable).toBe(false);
    expect(applyFixes(`a ${EM_DASH}`, [finding!])).toBe(`a ${EM_DASH}`);
  });

  it('applies a string fix', async () => {
    const text = `a ${EM_DASH} b`;
    const findings = await scanText(text, 'a.md', [fixed], { assumeText: true });
    expect(applyFixes(text, findings)).toBe('a - b');
  });

  it('applies several fixes right to left', async () => {
    const text = `${EM_DASH}one${EM_DASH}two${EM_DASH}`;
    const findings = await scanText(text, 'a.md', [rule({ id: 'wide', fix: '<<>>' })], {
      assumeText: true,
    });
    expect(applyFixes(text, findings)).toBe('<<>>one<<>>two<<>>');
  });

  it('is idempotent, and the result scans clean', async () => {
    const text = `a ${EM_DASH} b\r\nc ${EM_DASH} d\r\n`;
    const once = applyFixes(text, await scanText(text, 'a.md', [fixed], { assumeText: true }));
    const twice = applyFixes(once, await scanText(once, 'a.md', [fixed], { assumeText: true }));
    expect(twice).toBe(once);
    expect(await scanText(once, 'a.md', [fixed], { assumeText: true })).toEqual([]);
  });

  it('does not normalize line endings or drop a byte order mark', async () => {
    const text = `${BYTE_ORDER_MARK}a ${EM_DASH} b\r\nsecond\r\n`;
    const result = applyFixes(text, await scanText(text, 'a.md', [fixed], { assumeText: true }));
    expect(result.startsWith(BYTE_ORDER_MARK)).toBe(true);
    expect(result).toBe(`${BYTE_ORDER_MARK}a - b\r\nsecond\r\n`);
  });

  /**
   * The sentence, not the line. Hard-wrapped prose is the normal case in a repository, and
   * a line is a typographic accident: the two halves of an aside routinely land on
   * different ones.
   */
  it('passes the enclosing sentence as the fix context for a raw rule', async () => {
    const seen: { container: string; index: number }[] = [];
    const text = `A first sentence. A wrapped one\nholding ${EM_DASH} a dash. A third.\n`;
    await scanText(
      text,
      'a.md',
      [
        rule({
          id: 'context',
          fix: (ctx) => {
            seen.push({ container: ctx.container, index: ctx.index });
            return '';
          },
        }),
      ],
      { assumeText: true },
    );
    expect(seen).toEqual([{ container: `A wrapped one\nholding ${EM_DASH} a dash.`, index: 22 }]);
    expect(seen[0]!.container[seen[0]!.index]).toBe(EM_DASH);
  });

  it('locates each match inside a container that holds several', async () => {
    const seen: number[] = [];
    const text = `one ${EM_DASH} two ${EM_DASH} three.\n`;
    await scanText(
      text,
      'a.md',
      [
        rule({
          id: 'context',
          fix: (ctx) => {
            seen.push(ctx.index);
            return '';
          },
        }),
      ],
      { assumeText: true },
    );
    expect(seen).toEqual([4, 10]);
  });
});
