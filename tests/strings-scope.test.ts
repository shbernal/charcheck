import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { applyFixes } from '../src/fix.js';
import { scanText } from '../src/scan.js';
import { MissingPeerDependencyError } from '../src/scope/missing-peer.js';
import { scopeSupportsFile } from '../src/scope/index.js';
import { rule } from './helpers.js';

const stringsRule = rule({ id: 'no-em-dash', scope: 'strings' });

describe('the strings scope', () => {
  it('flags a string literal', async () => {
    const source = `const label = "one ${EM_DASH} two";\n`;
    const [finding] = await scanText(source, 'a.ts', [stringsRule]);
    expect(finding).toMatchObject({ line: 1, column: 20 });
  });

  it('exempts line and block comments', async () => {
    const source = [
      `// a comment ${EM_DASH} with a dash`,
      `/* another ${EM_DASH} one */`,
      `const ok = 'clean';`,
    ].join('\n');
    expect(await scanText(source, 'a.ts', [stringsRule])).toEqual([]);
  });

  it('flags template literal parts but not the expressions between them', async () => {
    const source = 'const t = `head ' + EM_DASH + ' ${value} tail ' + EM_DASH + '`;\n';
    const findings = await scanText(source, 'a.ts', [stringsRule]);
    expect(findings).toHaveLength(2);
  });

  it('computes positions against the raw source slice, not the cooked value', async () => {
    // The escape is two characters in the source and one in the value; a position taken
    // from the cooked string would land a column early.
    const source = `const s = "a\\nb ${EM_DASH}";\n`;
    const [finding] = await scanText(source, 'a.ts', [stringsRule]);
    expect(source[finding!.offset]).toBe(EM_DASH);
    expect(finding!.column).toBe(source.indexOf(EM_DASH) + 1);
  });

  it('gives the fix the literal as its context, not the line', async () => {
    const seen: string[] = [];
    const source = `const s = "inside ${EM_DASH}"; // outside ${EM_DASH}\n`;
    await scanText(source, 'a.ts', [
      rule({
        id: 'context',
        scope: 'strings',
        fix: (ctx) => {
          seen.push(ctx.container);
          return '';
        },
      }),
    ]);
    expect(seen).toEqual([`"inside ${EM_DASH}"`]);
  });

  it('parses tsx, mts and cjs', async () => {
    for (const file of ['a.tsx', 'a.mts', 'a.cjs']) {
      const findings = await scanText(`const s = "x ${EM_DASH}";\n`, file, [stringsRule]);
      expect(findings, file).toHaveLength(1);
    }
  });

  it('finds nothing in a file it cannot parse', async () => {
    expect(await scanText(`prose ${EM_DASH} here`, 'a.md', [stringsRule])).toEqual([]);
    expect(scopeSupportsFile('strings', 'a.md')).toBe(false);
    expect(scopeSupportsFile('strings', 'a.ts')).toBe(true);
    expect(scopeSupportsFile('raw', 'a.png')).toBe(true);
  });

  it('rewrites only the literal when fixing', async () => {
    const source = `// keep ${EM_DASH} me\nconst s = "fix ${EM_DASH} me";\n`;
    const findings = await scanText(source, 'a.ts', [
      rule({ id: 'fixer', scope: 'strings', fix: '-' }),
    ]);
    expect(applyFixes(source, findings)).toBe(`// keep ${EM_DASH} me\nconst s = "fix - me";\n`);
  });

  it('names the package when an optional parser is missing', () => {
    const error = new MissingPeerDependencyError('typescript', 'strings');
    expect(error.message).toContain('typescript');
    expect(error.message).toContain('strings');
  });
});
