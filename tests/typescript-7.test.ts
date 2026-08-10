/**
 * TypeScript 7 moved the parser out of the package and left a scanner, so this scope reads
 * it a second way. The test drives the real thing: `typescript-next` is an alias for
 * TypeScript 7 in this repo's devDependencies, installed alongside the TypeScript 5 the
 * rest of the suite uses, so both readers are exercised against the compilers they are for.
 *
 * The property under test is that they agree. A second reader is only defensible if it
 * finds the same literals as the first, and the corpus below is where that is proved.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { scanText } from '../src/scan.js';
import { JsxUnsupportedError } from '../src/scope/missing-peer.js';
import { astReader, scannerReader, type ScriptLanguage } from '../src/scope/strings.js';
import { resolveTokenKinds, UnknownTokenKindError } from '../src/scope/token-kinds.js';
import { rule } from './helpers.js';

// Imported through variables because TypeScript 7's `unstable` subpaths ship no types the
// TypeScript 5 in this repo can resolve. The shapes are asserted below rather than declared.
const ts5 = (await import('typescript')).default;
const ts7 = (await import('typescript-next/unstable/ast' as string)) as {
  SyntaxKind: Record<string, unknown>;
  createScanner: Parameters<typeof scannerReader>[0]['createScanner'];
  LanguageVariant: Record<string, unknown>;
};
const ts7version = ((await import('typescript-next' as string)) as { version: string }).version;

const fromAst = astReader(ts5);
const fromScanner = scannerReader(ts7 as Parameters<typeof scannerReader>[0]);

const read = (
  reader: ReturnType<typeof astReader>,
  source: string,
  language: ScriptLanguage = 'ts',
): string[] =>
  reader(source, language, 'a.ts', 'strings').map(({ start, end }) => source.slice(start, end));

/** Both readers, over the same source, must produce the same slices. */
function agree(source: string, language: ScriptLanguage = 'ts'): string[] {
  const viaAst = read(fromAst, source, language);
  expect(read(fromScanner, source, language)).toEqual(viaAst);
  return viaAst;
}

describe('the installed typescript', () => {
  it('is a 7 under the alias and a 5 or 6 under the plain name', () => {
    expect(ts7version).toMatch(/^7\./);
    expect(ts5.version).toMatch(/^[56]\./);
  });
});

describe('the scanner reader, against the syntax tree reader', () => {
  it('finds the same string literals', () => {
    expect(agree(`const a = 'one'; const b = "two";`)).toEqual([`'one'`, `"two"`]);
  });

  it('finds the same template parts, substitutions and all', () => {
    expect(agree('const t = `a ${x} b ${y} c`;')).toEqual(['`a ${', '} b ${', '} c`']);
  });

  it('agrees on a template holding an object literal', () => {
    expect(agree('const t = `a ${ {k: "v"} } b`;')).toEqual(['`a ${', '"v"', '} b`']);
  });

  it('agrees on a template nested inside a template', () => {
    expect(agree('const t = `a ${ `b ${ "c" } d` } e`;')).toEqual([
      '`a ${',
      '`b ${',
      '"c"',
      '} d`',
      '} e`',
    ]);
  });

  it('reads neither line nor block comments', () => {
    expect(agree(`// don't read "this"\n/* nor "this" */\nconst s = "kept";`)).toEqual([`"kept"`]);
  });

  it('keeps the raw slice when the literal holds an escape', () => {
    expect(agree(String.raw`const s = "a \" b";`)).toEqual([String.raw`"a \" b"`]);
  });

  // A regular expression read as division leaves the rest of the line tokenized as code,
  // and a quote inside it opens a literal that swallows real text. Each ambiguous position
  // gets its own case because each is decided by different state in the walk.
  describe('regular expressions against division', () => {
    it('after an assignment', () => {
      expect(agree(String.raw`const r = /["']/g; const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('after the parenthesis of a clause header', () => {
      expect(agree(String.raw`if (x) /"/.test(y); const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('after the brace of a block', () => {
      expect(agree(String.raw`function f() {} /"/.test(y); const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('after the parenthesis of a call, which divides', () => {
      expect(agree(`const n = (a + b) / c; const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('after the brace of an object literal, which divides', () => {
      expect(agree(`const n = {a: 1}.a / 2; const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('after an index, which divides', () => {
      expect(agree(`const n = a[0] / c / d; const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('with an escaped slash in the pattern', () => {
      expect(agree(String.raw`const r = /a\/"b/; const s = "kept";`)).toEqual([`"kept"`]);
    });

    it('with a brace inside a character class', () => {
      expect(agree('const r = /[{}]/; const t = `a ${1} b`;')).toEqual(['`a ${', '} b`']);
    });
  });

  describe('typescript syntax the scanner has to walk past', () => {
    it('an angle-bracket assertion', () => {
      expect(agree(`const s = <string>"kept";`)).toEqual([`"kept"`]);
    });

    it('a generic arrow', () => {
      expect(agree(`const f = <T,>(x: T) => "kept";`)).toEqual([`"kept"`]);
    });

    it('an enum member', () => {
      expect(agree(`enum E { A = "kept" }`)).toEqual([`"kept"`]);
    });

    it('a decorator and an import attribute', () => {
      expect(
        agree(`@dec("a") class C {}\nimport d from "./d.json" with { type: "json" };`),
      ).toEqual([`"a"`, `"./d.json"`, `"json"`]);
    });
  });

  it('agrees on every source file in this repository', () => {
    const files = [...walk('src'), ...walk('tests')];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(read(fromScanner, source), file).toEqual(read(fromAst, source));
    }
  });
});

describe('jsx, which a scanner cannot be told it is inside', () => {
  it('is refused rather than mis-read', () => {
    expect(() => read(fromScanner, `const a = <p>don't</p>;`, 'tsx')).toThrow(JsxUnsupportedError);
    expect(() => read(fromScanner, `const a = <p>don't</p>;`, 'jsx')).toThrow(JsxUnsupportedError);
  });

  it('names the file, so the rule can exclude it', () => {
    const thrown = (() => {
      try {
        fromScanner('<p />', 'tsx', 'site/Card.tsx', 'strings');
      } catch (error) {
        return error as Error;
      }
      return undefined;
    })();
    expect(thrown?.message).toContain('site/Card.tsx');
    expect(thrown?.message).toContain('strings');
  });

  it('is still read by the syntax tree reader, which has the context', () => {
    expect(read(fromAst, `const a = <p>don't</p>; const s = "kept";`, 'tsx')).toEqual([`"kept"`]);
  });
});

describe('a syntax kind enum missing a name', () => {
  it('is an error rather than a scan that matches nothing', () => {
    const rest = { ...ts7.SyntaxKind };
    delete rest['EndOfFile'];
    expect(() => resolveTokenKinds(rest)).toThrow(UnknownTokenKindError);
  });
});

describe('a rule reaching the scope', () => {
  it('reports the literal and not the comment beside it', async () => {
    const source = `// a ${EM_DASH} note\nconst s = "a ${EM_DASH} b";\n`;
    const findings = await scanText(source, 'a.ts', [rule({ id: 'dash', scope: 'strings' })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // Fixtures hold deliberately malformed sources, and JSX is out of the scanner's reach.
    if (entry.isDirectory()) {
      if (entry.name !== 'fixtures') out.push(...walk(full));
    } else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
