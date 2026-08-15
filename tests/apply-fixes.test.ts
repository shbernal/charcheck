/**
 * `applyFixes` against text that is not the text the findings came from.
 *
 * A finding is a position plus what was there, and nothing in the type system pairs it with
 * its source. The fixer is therefore given text it cannot prove is the right text, which is
 * exactly what `--fix --staged` does: findings from the git index, rewriting the working
 * tree. See `tests/git.test.ts` for that path end to end.
 */

import { describe, expect, it } from 'vitest';

import { BYTE_ORDER_MARK, EM_DASH, charClass } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import type { SkipReason } from '../src/fix.js';
import { scanText } from '../src/scan.js';
import type { Finding } from '../src/types.js';
import { rule } from './helpers.js';

const dashWithSpaces = `\\s*[${charClass([EM_DASH])}]\\s*`;

async function findingsIn(text: string): Promise<Finding[]> {
  return scanText(text, 'a.md', [rule({ id: 'no-em-dash', fix: '-' })], { assumeText: true });
}

function skipsFrom(text: string, findings: readonly Finding[]): [Finding, SkipReason][] {
  const skipped: [Finding, SkipReason][] = [];
  applyFixes(text, findings, { onSkipped: (finding, reason) => skipped.push([finding, reason]) });
  return skipped;
}

describe('text the findings did not come from', () => {
  it('writes nothing when the match is no longer at the offset', async () => {
    const scanned = `a${EM_DASH}b\n`;
    const findings = await findingsIn(scanned);
    expect(findings).toHaveLength(1);

    // The shape that destroyed content: different text, no banned character anywhere, and a
    // recorded offset that happens to be inside it.
    const other = 'hello world here\n';
    expect(applyFixes(other, findings)).toBe(other);
  });

  it('reports the skip as stale rather than passing silently', async () => {
    const findings = await findingsIn(`a${EM_DASH}b\n`);
    const skipped = skipsFrom('hello world here\n', findings);
    expect(skipped.map(([, reason]) => reason)).toEqual(['stale']);
  });

  it('still fixes the findings whose text is intact', async () => {
    // Two findings; only the first one's span survives into the text handed over.
    const scanned = `a${EM_DASH}b and c${EM_DASH}d\n`;
    const findings = await findingsIn(scanned);
    expect(findings).toHaveLength(2);

    // The tail is rewritten, so the second offset no longer holds a dash. The first is
    // untouched and must still be applied.
    const drifted = `a${EM_DASH}b and REPLACED\n`;
    expect(applyFixes(drifted, findings)).toBe('a-b and REPLACED\n');
  });

  it('leaves a shorter text alone rather than splicing past its end', async () => {
    const findings = await findingsIn(`long enough ${EM_DASH} to matter\n`);
    expect(applyFixes('short\n', findings)).toBe('short\n');
  });

  it('is unaffected when the text is the one that was scanned', async () => {
    const scanned = `a${EM_DASH}b\n`;
    const findings = await findingsIn(scanned);
    expect(applyFixes(scanned, findings)).toBe('a-b\n');
    expect(skipsFrom(scanned, findings)).toEqual([]);
  });

  // The byte order mark is stripped before scanning, so offsets are relative to the text
  // without it. The check has to compare in the same coordinates or every fix would read
  // as stale on a file that has one.
  it('checks against the text with the byte order mark already stripped', async () => {
    const scanned = `a${EM_DASH}b\n`;
    const findings = await findingsIn(scanned);
    expect(applyFixes(`${BYTE_ORDER_MARK}${scanned}`, findings)).toBe(`${BYTE_ORDER_MARK}a-b\n`);
  });
});

describe('overlapping findings', () => {
  it('reports the one it skipped', async () => {
    const text = `one ${EM_DASH} two\n`;
    const findings = [
      ...(await scanText(text, 'a.md', [rule({ id: 'plain', fix: '-' })], { assumeText: true })),
      ...(await scanText(
        text,
        'a.md',
        [rule({ id: 'spaced', chars: undefined, pattern: dashWithSpaces, fix: ' - ' })],
        { assumeText: true },
      )),
    ];
    expect(findings).toHaveLength(2);

    const skipped = skipsFrom(text, findings);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]![1]).toBe('overlap');
    // The wider span is the one dropped, since the fixer works right to left.
    expect(skipped[0]![0].ruleId).toBe('spaced');
  });
});
