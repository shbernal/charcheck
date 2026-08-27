import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { formatPretty } from '../src/report/pretty.js';
import { formatSarif } from '../src/report/sarif.js';
import { scanText } from '../src/scan.js';
import type { Finding, Rule } from '../src/types.js';
import { emDashRule } from './helpers.js';

/**
 * The pattern the docs recommend for a clause separator. It takes the whitespace around the
 * dash on purpose, and in hard-wrapped prose that whitespace is a line ending.
 */
const clause: Rule = { id: 'clause', pattern: `\\s*${EM_DASH}\\s*`, include: ['**/*'] };

const WRAPPED = `a wrapped ${EM_DASH}\nline here\n`;
const WRAPPED_CRLF = `a wrapped ${EM_DASH}\r\nline here\r\n`;

async function one(text: string, target = clause): Promise<Finding> {
  const findings = await scanText(text, 'a.md', [target], { assumeText: true });
  expect(findings).toHaveLength(1);
  return findings[0]!;
}

function region(finding: Finding): Record<string, number> {
  const report = JSON.parse(formatSarif([finding])) as {
    runs: {
      results: { locations: { physicalLocation: { region: Record<string, number> } }[] }[];
    }[];
  };
  return report.runs[0]!.results[0]!.locations[0]!.physicalLocation.region;
}

describe('a match that spans a line break', () => {
  it('ends at a column on a later line', async () => {
    const finding = await one(WRAPPED);
    // The match runs from the space before the dash to the start of the next line, so its
    // end column is a column there rather than one further along line 1.
    expect(finding).toMatchObject({ line: 1, column: 10, endColumn: 1 });
    expect(finding.match).toBe(` ${EM_DASH}\n`);
  });

  it('carries the end line the column belongs to in sarif', async () => {
    expect(region(await one(WRAPPED))).toEqual({
      startLine: 1,
      startColumn: 10,
      endLine: 2,
      endColumn: 1,
    });
  });

  it('counts a CRLF ending once', async () => {
    expect(region(await one(WRAPPED_CRLF))).toEqual({
      startLine: 1,
      startColumn: 10,
      endLine: 2,
      endColumn: 1,
    });
  });

  it('underlines the visible part of the match rather than one column', async () => {
    const finding = await one(WRAPPED);
    const text = formatPretty([finding], { sources: new Map([['a.md', WRAPPED]]) });
    // From the space before the dash to the end of the excerpt: two columns, not the single
    // caret a negative width would have been clamped to.
    expect(text).toContain(`  ${' '.repeat(9)}^^\n`);
  });
});

describe('a match on one line', () => {
  it('emits the sarif region unchanged, since code scanning ingests it', async () => {
    const finding = await one(`first\nprose ${EM_DASH} here\n`, emDashRule);
    const shape = region(finding);
    expect(Object.keys(shape)).toEqual(['startLine', 'startColumn', 'endColumn']);
    expect(shape).toEqual({ startLine: 2, startColumn: 7, endColumn: 8 });
  });

  it('underlines exactly the match', async () => {
    const text = `prose ${EM_DASH} here\n`;
    const finding = await one(text, emDashRule);
    expect(formatPretty([finding], { sources: new Map([['a.md', text]]) })).toContain(
      `  ${' '.repeat(6)}^\n`,
    );
  });
});
