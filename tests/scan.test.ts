import { describe, expect, it } from 'vitest';

import { BYTE_ORDER_MARK, EM_DASH, EN_DASH, HORIZONTAL_BAR } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { RuleError, compileRule } from '../src/rule.js';
import { looksBinary, scanText } from '../src/scan.js';
import type { Finding } from '../src/types.js';
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

  it('does not end a tilde fence on a backtick line inside it', async () => {
    // CommonMark closes a fence only on the same character. Toggling on any fence ended the
    // block here, and the marker in the rest of the example took effect.
    const text = [
      '~~~',
      '```',
      'charcheck-disable-file',
      '```',
      '~~~',
      '',
      `prose ${EM_DASH} here`,
    ].join('\n');
    const findings = await scanText(text, 'README.md', [emDashRule], { assumeText: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(7);
  });

  it('does not end a longer fence on a shorter one inside it', async () => {
    const text = [
      '````',
      '```',
      'charcheck-disable-file',
      '```',
      '````',
      '',
      `prose ${EM_DASH} here`,
    ].join('\n');
    const findings = await scanText(text, 'README.md', [emDashRule], { assumeText: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(7);
  });

  it('does not end a fence on a line that carries an info string', async () => {
    // Only an opener may be followed by one, so a `\`\`\`js` inside a block is content.
    const text = [
      '```',
      '```js',
      'charcheck-disable-file',
      '```',
      '',
      `prose ${EM_DASH} here`,
    ].join('\n');
    const findings = await scanText(text, 'README.md', [emDashRule], { assumeText: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(6);
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

  it('reads a rule id written flush against a comment terminator', async () => {
    // Reported against 0.2.5: the unspaced form parsed as no rule ids at all, and no rule
    // ids means every rule, so a marker naming one rule silenced every rule on the line.
    // One space either side of the id was the whole difference.
    const both = [emDashRule, rule({ id: 'other' })];
    for (const [marker, file] of [
      [`<!--charcheck-disable-next-line no-em-dash-->`, 'a.md'],
      [`/*charcheck-disable-next-line no-em-dash*/`, 'a.ts'],
      [`{{!--charcheck-disable-next-line no-em-dash--}}`, 'a.hbs'],
      [`{#charcheck-disable-next-line no-em-dash#}`, 'a.jinja'],
    ] as const) {
      const findings = await scanText(`${marker}\nvalue ${EM_DASH}`, file, both, {
        assumeText: true,
      });
      expect(
        findings.map((f) => f.ruleId),
        marker,
      ).toEqual(['other']);
    }
  });

  it('suppresses nothing, not everything, when a rule id is unreadable', async () => {
    // The failure direction is the point. An id the parser cannot read has to degrade to a
    // suppression that does nothing, because the opposite degradation removes checks and
    // does it silently, in whichever file the author was editing at the time.
    const text = `<!-- charcheck-disable-next-line no-em-dash! -->\nvalue ${EM_DASH}`;
    const findings = await scanText(text, 'a.md', [emDashRule, rule({ id: 'other' })], {
      assumeText: true,
    });
    expect(findings.map((f) => f.ruleId)).toEqual(['no-em-dash', 'other']);
  });

  it('still suppresses every rule for a bare marker against a terminator', async () => {
    const text = `<!--charcheck-disable-next-line-->\nvalue ${EM_DASH}`;
    expect(await scanText(text, 'a.md', [emDashRule], { assumeText: true })).toEqual([]);
  });

  it('hands a silenced finding to onSuppressed rather than returning it', async () => {
    const text = `<!-- charcheck-disable-next-line -->\nvalue ${EM_DASH}`;
    const suppressed: Finding[] = [];
    const findings = await scanText(text, 'a.md', [emDashRule], {
      assumeText: true,
      onSuppressed: (finding) => suppressed.push(finding),
    });
    expect(findings).toEqual([]);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]).toMatchObject({ ruleId: 'no-em-dash', line: 2, column: 7 });
  });

  it('resolves a fix on a suppressed finding, so it is a whole finding', async () => {
    // It has to be, since the SARIF report emits it as a result beside the ones that were
    // reported. A half-built finding there would be a shape no consumer could branch on.
    const text = `<!-- charcheck-disable-next-line -->\nvalue ${EM_DASH}`;
    const suppressed: Finding[] = [];
    await scanText(text, 'a.md', [rule({ id: 'to-hyphen', fix: '-' })], {
      assumeText: true,
      onSuppressed: (finding) => suppressed.push(finding),
    });
    expect(suppressed[0]).toMatchObject({ fixable: true, replacement: '-' });
  });

  it('does not resolve a fix when nobody asked what was suppressed', async () => {
    // The cheap path has to stay cheap: a fix is a function the config supplies, and a
    // suppressed match must not be paying for one nobody will read.
    let calls = 0;
    const text = `<!-- charcheck-disable-next-line -->\nvalue ${EM_DASH}`;
    const counted = rule({
      id: 'counting',
      fix: () => {
        calls += 1;
        return '-';
      },
    });
    expect(await scanText(text, 'a.md', [counted], { assumeText: true })).toEqual([]);
    expect(calls).toBe(0);
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

/**
 * A rule is matched against the whole file once, and each region a scope hands back is then
 * asked whether any of those matches could fall inside it. A region with none is skipped
 * without running the engine over it again, which is what keeps a document of thousands of
 * regions linear in its size.
 *
 * The offsets below are the `html` scope's, whose regions are the easiest to state exactly:
 * `<p>AB</p>` gives one region covering `AB`, at offsets 3 to 5.
 */
describe('matching against a region of a file', () => {
  const source = '<p>AB</p>';
  const inRegion = (chars: string[]): Promise<Finding[]> =>
    scanText(source, 'a.html', [rule({ id: 'r', chars, scope: 'html' })], { assumeText: true });

  it('reports a match starting on the first character of the region', async () => {
    const findings = await inRegion(['A']);
    expect(findings.map((finding) => finding.offset)).toEqual([3]);
  });

  it('reports a match ending on the last character of the region', async () => {
    const findings = await inRegion(['B']);
    expect(findings.map((finding) => finding.offset)).toEqual([4]);
  });

  it('reports a match spanning the whole region', async () => {
    const findings = await inRegion(['AB']);
    expect(findings.map((finding) => finding.offset)).toEqual([3]);
  });

  it('ignores a match ending exactly where the region opens', async () => {
    // `>` at offset 2 ends at 3, and the region starts at 3. Touching is not overlapping.
    expect(await inRegion(['>'])).toEqual([]);
  });

  it('ignores a match starting exactly where the region closes', async () => {
    // `<` of the closing tag is at offset 5, and the region ends at 5.
    expect(await inRegion(['<'])).toEqual([]);
  });

  it('ignores a match that only surrounds the region', async () => {
    expect(await inRegion(['p'])).toEqual([]);
  });

  it('reports the longest match that fits where the greedy one runs past the region', async () => {
    // The greedy match takes `</p>` with it and so is not in the region at all. Stepping a
    // character forward finds nothing, because the pattern ends in the banned character, so
    // the finding used to be dropped in silence.
    const findings = await scanText(
      '<p>a B</p>',
      'a.html',
      [rule({ id: 'r', chars: undefined, pattern: '\\s*B[\\s\\S]*' })],
      { assumeText: true },
    );
    expect(findings.map((finding) => finding.match)).toEqual([' B</p>']);

    const scoped = await scanText(
      '<p>a B</p>',
      'a.html',
      [rule({ id: 'r', chars: undefined, pattern: '\\s*B[\\s\\S]*', scope: 'html' })],
      { assumeText: true },
    );
    expect(scoped.map((finding) => finding.match)).toEqual([' B']);
    expect(scoped[0]!.offset).toBe(4);
  });

  it('drops an overrunning match at a region end without losing the one before it', async () => {
    // Nothing shorter fits where the second match starts, so that one is still not reported,
    // and the collector has to leave the region rather than retry the same place forever.
    const findings = await scanText(
      '<p>a b c</p>',
      'a.html',
      [rule({ id: 'r', chars: undefined, pattern: '[ac][\\s\\S]{3}', scope: 'html' })],
      { assumeText: true },
    );
    expect(findings.map((finding) => finding.offset)).toEqual([3]);
  });

  it('finds a lone match among many regions holding none', async () => {
    // The case the whole arrangement exists for: one banned character, thousands of regions.
    let document = '';
    for (let i = 0; i < 500; i += 1) document += `Paragraph ${i} with \`code\` and *stress*.\n\n`;
    document += `tail ${EM_DASH} end\n`;

    const findings = await scanText(document, 'big.md', [rule({ id: 'r', scope: 'markdown' })], {
      assumeText: true,
    });
    expect(findings).toHaveLength(1);
    expect(document[findings[0]!.offset]).toBe(EM_DASH);
  });
});
