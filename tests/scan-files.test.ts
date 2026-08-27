import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EM_DASH } from '../src/chars.js';
import { relativeToRoot, toPosix } from '../src/paths.js';
import { scan } from '../src/scan-files.js';
import { rule } from './helpers.js';

let root: string;

async function write(relative: string, contents: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-'));
  await write('docs/guide.md', `prose ${EM_DASH} here\n`);
  await write('docs/clean.md', 'nothing to see\n');
  await write('src/app.ts', `const s = "text ${EM_DASH}"; // comment ${EM_DASH}\n`);
  await write('src/nested/deep.md', `deep ${EM_DASH}\n`);
  await write('node_modules/pkg/readme.md', `vendored ${EM_DASH}\n`);
  await write('dist/built.md', `generated ${EM_DASH}\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scan', () => {
  it('resolves each rule against its own globs', async () => {
    const findings = await scan({
      root,
      rules: [rule({ id: 'md', include: ['**/*.md'] })],
    });
    expect(findings.map((f) => f.file)).toEqual(
      ['docs/guide.md', 'dist/built.md', 'src/nested/deep.md'].sort(),
    );
  });

  it('ignores node_modules and .git without being asked', async () => {
    const findings = await scan({ root, rules: [rule({ id: 'md', include: ['**/*.md'] })] });
    expect(findings.some((f) => f.file.includes('node_modules'))).toBe(false);
  });

  it('honours a rule exclude and a global ignore', async () => {
    const findings = await scan({
      root,
      rules: [rule({ id: 'md', include: ['**/*.md'], exclude: ['dist/**'] })],
      ignore: ['**/nested/**'],
    });
    expect(findings.map((f) => f.file)).toEqual(['docs/guide.md']);
  });

  it('applies a scope per rule, in the same run', async () => {
    const findings = await scan({
      root,
      rules: [
        rule({ id: 'prose', include: ['docs/**/*.md'] }),
        rule({ id: 'code', include: ['src/**/*.ts'], scope: 'strings' }),
      ],
    });
    expect(findings.map((f) => `${f.ruleId}:${f.file}`)).toEqual([
      'prose:docs/guide.md',
      'code:src/app.ts',
    ]);
  });

  it('reads a file matched by two rules once and reports both', async () => {
    const findings = await scan({
      root,
      rules: [
        rule({ id: 'first', include: ['docs/guide.md'] }),
        rule({ id: 'second', include: ['docs/**'] }),
      ],
    });
    expect(findings.map((f) => f.ruleId).sort()).toEqual(['first', 'second']);
  });

  it('restricts to an explicit file list, still filtered by the globs', async () => {
    const findings = await scan({
      root,
      rules: [rule({ id: 'md', include: ['docs/**/*.md'] })],
      files: ['docs/guide.md', 'src/nested/deep.md', path.join(root, 'docs', 'clean.md')],
    });
    expect(findings.map((f) => f.file)).toEqual(['docs/guide.md']);
  });

  it('accepts backslash paths in the explicit list', async () => {
    const findings = await scan({
      root,
      rules: [rule({ id: 'md', include: ['**/*.md'] })],
      files: ['docs\\guide.md'],
    });
    expect(findings.map((f) => f.file)).toEqual(['docs/guide.md']);
  });

  it('reports POSIX paths relative to the root', async () => {
    const findings = await scan({ root, rules: [rule({ id: 'md', include: ['**/nested/*.md'] })] });
    expect(findings[0]!.file).toBe('src/nested/deep.md');
  });

  it('tolerates a path that vanished between globbing and reading', async () => {
    const findings = await scan({
      root,
      rules: [rule({ id: 'md', include: ['**/*.md'] })],
      files: ['docs/gone.md'],
    });
    expect(findings).toEqual([]);
  });
});

/**
 * A directory is no file's own path, so it once survived the restriction as nothing at all
 * and the run reported the tree it was pointed at as clean.
 */
describe('a path naming a directory', () => {
  let tree: string;

  beforeAll(async () => {
    tree = await mkdtemp(path.join(os.tmpdir(), 'charcheck-dir-'));
    await mkdir(path.join(tree, 'src', 'nested'), { recursive: true });
    await mkdir(path.join(tree, 'srcery'), { recursive: true });
    await writeFile(path.join(tree, 'src', 'a.md'), `a ${EM_DASH}\n`, 'utf8');
    await writeFile(path.join(tree, 'src', 'nested', 'b.md'), `b ${EM_DASH}\n`, 'utf8');
    await writeFile(path.join(tree, 'srcery', 'c.md'), `c ${EM_DASH}\n`, 'utf8');
  });

  afterAll(async () => {
    await rm(tree, { recursive: true, force: true });
  });

  const filesFrom = async (files: readonly string[]): Promise<string[]> => {
    const findings = await scan({
      root: tree,
      rules: [rule({ id: 'md', include: ['**/*.md'] })],
      files,
    });
    return findings.map((finding) => finding.file);
  };

  it('selects every file under it, at any depth', async () => {
    expect(await filesFrom(['src'])).toEqual(['src/a.md', 'src/nested/b.md']);
  });

  it('selects the same files with a trailing slash', async () => {
    expect(await filesFrom(['src/'])).toEqual(['src/a.md', 'src/nested/b.md']);
  });

  it('selects the same files when absolute', async () => {
    expect(await filesFrom([path.join(tree, 'src')])).toEqual(['src/a.md', 'src/nested/b.md']);
  });

  it('does not reach a sibling that shares its name as a prefix', async () => {
    expect(await filesFrom(['src'])).not.toContain('srcery/c.md');
  });

  it('still narrows to a single file when one is named', async () => {
    expect(await filesFrom(['src/nested/b.md'])).toEqual(['src/nested/b.md']);
  });
});

describe('a path that reaches nothing', () => {
  const unmatched = async (files: readonly string[]): Promise<string[]> => {
    const seen: string[] = [];
    await scan({
      root,
      rules: [rule({ id: 'md', include: ['docs/**/*.md'] })],
      files,
      onUnmatchedPath: (file) => seen.push(file),
    });
    return seen;
  };

  it('is reported when it names a file no rule targets', async () => {
    expect(await unmatched(['src/app.ts'])).toEqual(['src/app.ts']);
  });

  it('is reported when it names a directory no rule targets', async () => {
    expect(await unmatched(['src/nested'])).toEqual(['src/nested']);
  });

  it('is reported once however many times it was passed', async () => {
    expect(await unmatched(['src/nested', 'src/nested/'])).toEqual(['src/nested']);
  });

  it('is silent for a path a rule does target', async () => {
    expect(await unmatched(['docs', 'src/app.ts'])).toEqual(['src/app.ts']);
  });
});

/**
 * A rule that reaches nothing produces a clean run, which is the one failure the report
 * cannot show on its own. The commonest cause by far is a dotted directory, which is only
 * walked into when a pattern names it.
 */
describe('a rule whose globs match nothing', () => {
  const collect = async (
    rules: Parameters<typeof scan>[0]['rules'],
    files?: readonly string[],
  ): Promise<string[]> => {
    const warnings: string[] = [];
    await scan({
      root,
      rules,
      onWarning: (message) => warnings.push(message),
      ...(files ? { files } : {}),
    });
    return warnings;
  };

  it('is warned about, naming the rule and its patterns', async () => {
    const warnings = await collect([rule({ id: 'vue', include: ['site/**/*.vue'] })]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"vue"');
    expect(warnings[0]).toContain('site/**/*.vue');
    expect(warnings[0]).toContain('dotted directory');
  });

  it('is the case a pattern missing a dotted directory falls into', async () => {
    await write('.vitepress/theme/Card.vue', `text ${EM_DASH} here\n`);

    expect(await collect([rule({ id: 'blind', include: ['**/*.vue'] })])).toHaveLength(1);
    expect(await collect([rule({ id: 'naming', include: ['.vitepress/**/*.vue'] })])).toEqual([]);
  });

  it('stays quiet for a rule that matched, whatever the findings were', async () => {
    expect(await collect([rule({ id: 'md', include: ['docs/clean.md'] })])).toEqual([]);
  });

  // Under `--staged` the restriction is the staged file list, and a rule matching nothing
  // staged is the ordinary case. Warning there would fire on almost every commit.
  it('stays quiet when it was the file restriction that emptied the plan', async () => {
    expect(await collect([rule({ id: 'md', include: ['**/*.md'] })], ['src/app.ts'])).toEqual([]);
  });
});

/**
 * The same silent failure one step later: the globs found files, and the scope reads none of
 * them, so each is extracted as empty and the rule reports clean over a set it never read.
 *
 * Config load catches the decidable half, a pattern naming an extension its scope cannot
 * read. A directory glob states no intent about extensions and is passed over there, so this
 * is the only place the case can be caught, and only when it is certain.
 */
describe('a rule whose scope can read nothing it matched', () => {
  const collect = async (rules: Parameters<typeof scan>[0]['rules']): Promise<string[]> => {
    const warnings: string[] = [];
    await scan({ root, rules, onWarning: (message) => warnings.push(message) });
    return warnings;
  };

  it('is warned about, naming the scope and the count', async () => {
    const warnings = await collect([
      rule({ id: 'prose', include: ['src/**/*.ts'], scope: 'markdown' }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"prose"');
    expect(warnings[0]).toContain('"markdown"');
    expect(warnings[0]).toContain('reported as clean');
  });

  // The ordinary directory glob, which is what makes this worth warning about only when the
  // whole match set is unreadable. `docs/**` under `markdown` beside one `.png` is what
  // people mean, and a warning there would fire on most real configs.
  it('stays quiet when the scope can read even one of them', async () => {
    await write('docs/diagram.png', 'not really an image\n');
    expect(await collect([rule({ id: 'docs', include: ['docs/**'], scope: 'markdown' })])).toEqual(
      [],
    );
  });

  it('stays quiet for raw, which has no extension it cannot read', async () => {
    expect(await collect([rule({ id: 'any', include: ['src/**/*.ts'], scope: 'raw' })])).toEqual(
      [],
    );
  });

  // A rule that matched nothing at all is the warning above, and saying both would describe
  // one problem twice.
  it('leaves a rule that matched no files to the other warning', async () => {
    const warnings = await collect([
      rule({ id: 'none', include: ['nowhere/**/*.ts'], scope: 'markdown' }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('matched no files');
  });
});

describe('path normalization', () => {
  it('converts separators and strips a leading dot slash', () => {
    expect(toPosix('a\\b\\c.ts')).toBe('a/b/c.ts');
    expect(relativeToRoot('/root', './a/b.ts')).toBe('a/b.ts');
    expect(relativeToRoot(path.join(root, 'x'), path.join(root, 'x', 'y', 'z.ts'))).toBe('y/z.ts');
  });
});
