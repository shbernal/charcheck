import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EM_DASH, ZERO_WIDTH_SPACE } from '../src/chars.js';
import { ConfigNotFoundError, loadConfig } from '../src/config/load.js';
import { fileRules, toScanOptions, virtualRules } from '../src/config/resolve.js';
import { ConfigError, patternExtensions, validateConfig } from '../src/config/schema.js';
import type { CharcheckConfig, LoadedConfig } from '../src/config/types.js';
import { invisibles, noAiPunctuation } from '../src/presets/index.js';
import { scan } from '../src/scan-files.js';

let root: string;

async function write(relative: string, contents: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-config-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function problemsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected the config to be rejected');
}

describe('config validation', () => {
  const valid = { rules: [{ id: 'a', chars: [EM_DASH], include: ['**/*.md'] }] };

  it('accepts a minimal config', () => {
    expect(validateConfig(valid).rules).toHaveLength(1);
  });

  it('rejects a config that is not an object', () => {
    expect(() => validateConfig('nope')).toThrow(ConfigError);
    expect(() => validateConfig(undefined)).toThrow(ConfigError);
  });

  it('rejects missing or empty rules', () => {
    expect(problemsOf(() => validateConfig({}))[0]).toContain('"rules" must be an array');
    expect(problemsOf(() => validateConfig({ rules: [] }))[0]).toContain(
      'nothing would be checked',
    );
  });

  it('names the offending rule and field', () => {
    const problems = problemsOf(() =>
      validateConfig({ rules: [{ id: 'my-rule', chars: [EM_DASH] }] }),
    );
    expect(problems[0]).toContain('rule "my-rule"');
    expect(problems[0]).toContain('include');
  });

  it('falls back to the rule index when the id is unusable', () => {
    const problems = problemsOf(() => validateConfig({ rules: [{ chars: [EM_DASH] }] }));
    expect(problems.join('\n')).toContain('rules[0].id');
  });

  it('rejects both chars and pattern, and neither', () => {
    expect(
      problemsOf(() =>
        validateConfig({
          rules: [{ id: 'a', chars: [EM_DASH], pattern: 'x', include: ['*'] }],
        }),
      )[0],
    ).toContain('both');
    expect(problemsOf(() => validateConfig({ rules: [{ id: 'a', include: ['*'] }] }))[0]).toContain(
      'either',
    );
  });

  it('rejects an invalid regular expression', () => {
    const problems = problemsOf(() =>
      validateConfig({ rules: [{ id: 'a', pattern: '[unclosed', include: ['*'] }] }),
    );
    expect(problems[0]).toContain('not a valid regular expression');
  });

  it('rejects an unknown scope, a bad severity and a bad fix', () => {
    const problems = problemsOf(() =>
      validateConfig({
        rules: [
          {
            id: 'a',
            chars: [EM_DASH],
            include: ['*'],
            scope: 'prose',
            severity: 'fatal',
            fix: 42,
          },
        ],
      }),
    );
    expect(problems.join('\n')).toContain('scope must be one of');
    expect(problems.join('\n')).toContain('severity');
    expect(problems.join('\n')).toContain('fix');
  });

  it('rejects duplicate rule ids', () => {
    const problems = problemsOf(() =>
      validateConfig({
        rules: [
          { id: 'same', chars: [EM_DASH], include: ['*'] },
          { id: 'same', chars: [EM_DASH], include: ['*'] },
        ],
      }),
    );
    expect(problems.join('\n')).toContain('duplicate rule id "same"');
  });

  it('reports every problem at once', () => {
    const problems = problemsOf(() =>
      validateConfig({ rules: [{ id: '', include: [] }, 'not an object'] }),
    );
    expect(problems.length).toBeGreaterThan(2);
  });

  it('validates the markup options', () => {
    expect(
      problemsOf(() => validateConfig({ ...valid, markup: { textAttributes: 'title' } }))[0],
    ).toContain('markup.textAttributes');
    expect(validateConfig({ ...valid, markup: { textAttributes: ['heading'] } })).toBeTruthy();
  });

  it('validates the top-level attribute allowlist', () => {
    expect(problemsOf(() => validateConfig({ ...valid, textAttributes: 'title' }))[0]).toContain(
      '"textAttributes"',
    );
    expect(validateConfig({ ...valid, textAttributes: ['heading'] })).toBeTruthy();
  });

  it('refuses both spellings of the attribute allowlist at once', () => {
    const problems = problemsOf(() =>
      validateConfig({ ...valid, textAttributes: ['a'], markup: { textAttributes: ['b'] } }),
    );
    expect(problems.join('\n')).toContain('markup.textAttributes');
  });
});

describe('the attribute allowlist', () => {
  const loaded = (config: CharcheckConfig): LoadedConfig => ({
    config,
    filepath: '/repo/charcheck.config.js',
    root: '/repo',
  });
  const rules = [{ id: 'a', chars: [EM_DASH], include: ['**/*.html'] }];

  it('reads either spelling, preferring the top-level one', () => {
    expect(toScanOptions(loaded({ rules, textAttributes: ['a'] })).textAttributes).toEqual(['a']);
    expect(
      toScanOptions(loaded({ rules, markup: { textAttributes: ['b'] } })).textAttributes,
    ).toEqual(['b']);
  });

  it('is absent when neither is set, so the extractors keep their default', () => {
    expect(toScanOptions(loaded({ rules })).textAttributes).toBeUndefined();
  });
});

describe('scope against extension', () => {
  it('rejects a parser scope that can never match a file it can read', () => {
    for (const [scope, pattern] of [
      ['strings', 'docs/**/*.md'],
      ['markup', '**/*.md'],
    ] as const) {
      const problems = problemsOf(() =>
        validateConfig({ rules: [{ id: 'a', chars: [EM_DASH], scope, include: [pattern] }] }),
      );
      expect(problems.join('\n'), scope).toContain(scope);
    }
  });

  it('rejects a brace group that reaches past what the scope can read', () => {
    // The reachable half is no defence: the `.md` files would be scanned as empty and
    // reported as clean, which is the silent failure this whole check exists to catch.
    const problems = problemsOf(() =>
      validateConfig({
        rules: [{ id: 'a', chars: [EM_DASH], scope: 'strings', include: ['src/**/*.{ts,md}'] }],
      }),
    );
    expect(problems.join('\n')).toContain('.md');
    expect(problems.join('\n')).toContain('src/**/*.{ts,md}');
  });

  it('judges each pattern on its own, so an undecidable one cannot shield the rest', () => {
    const problems = problemsOf(() =>
      validateConfig({
        rules: [{ id: 'a', chars: [EM_DASH], scope: 'markdown', include: ['docs/**', '**/*.ts'] }],
      }),
    );
    expect(problems.join('\n')).toContain('**/*.ts');
  });

  it('accepts a pattern the scope can read', () => {
    expect(
      validateConfig({
        rules: [{ id: 'a', chars: [EM_DASH], scope: 'markdown', include: ['docs/**/*.md'] }],
      }),
    ).toBeTruthy();
  });

  it('says nothing about a pattern whose extension cannot be known', () => {
    expect(
      validateConfig({
        rules: [{ id: 'a', chars: [EM_DASH], scope: 'markup', include: ['components/**'] }],
      }),
    ).toBeTruthy();
  });

  it('leaves the raw scope alone', () => {
    expect(
      validateConfig({ rules: [{ id: 'a', chars: [EM_DASH], include: ['**/*.png'] }] }),
    ).toBeTruthy();
  });

  it('reads a trailing extension out of a pattern', () => {
    expect(patternExtensions('a/b/*.ts')).toEqual(['.ts']);
    expect(patternExtensions('a/*.{ts,tsx}')).toEqual(['.ts', '.tsx']);
    expect(patternExtensions('docs/**')).toBeUndefined();
    expect(patternExtensions('*')).toBeUndefined();
  });
});

describe('virtual targets', () => {
  const rules = [
    { id: 'files', chars: [EM_DASH], include: ['**/*.md'] },
    { id: 'commit', chars: [EM_DASH], include: ['<commit-msg>'] },
    { id: 'both', chars: [EM_DASH], include: ['**/*.md', '<commit-msg>'] },
  ];

  it('accepts a virtual pattern without complaining about its extension', () => {
    expect(validateConfig({ rules })).toBeTruthy();
  });

  it('keeps virtual patterns out of a file scan', () => {
    const forFiles = fileRules(rules);
    expect(forFiles.map((rule) => rule.id)).toEqual(['files', 'both']);
    expect(forFiles[1]!.include).toEqual(['**/*.md']);
  });

  it('finds the rules for a named surface', () => {
    expect(virtualRules(rules, 'commit-msg').map((rule) => rule.id)).toEqual(['commit', 'both']);
    expect(virtualRules(rules, 'other')).toEqual([]);
  });
});

describe('loading', () => {
  beforeAll(async () => {
    await write(
      'project/charcheck.config.ts',
      [
        'interface Config { rules: { id: string; chars: string[]; include: string[] }[] }',
        'const config: Config = {',
        `  rules: [{ id: 'ts-config', chars: ['\\u2014'], include: ['**/*.md'] }],`,
        '};',
        'export default config;',
      ].join('\n'),
    );
    await write('project/docs/page.md', `prose ${EM_DASH} here\n`);
    await write('project/nested/deep/keep.md', 'clean\n');
    await write(
      'json-project/charcheck.config.json',
      JSON.stringify({ rules: [{ id: 'json', chars: [EM_DASH], include: ['**/*.md'] }] }),
    );
    await write(
      'pkg-project/package.json',
      JSON.stringify({
        name: 'pkg-project',
        charcheck: { rules: [{ id: 'from-package', chars: [EM_DASH], include: ['**/*.md'] }] },
      }),
    );
    await write('empty-project/package.json', JSON.stringify({ name: 'empty' }));
    await write('bad-project/charcheck.config.json', JSON.stringify({ rules: [{ id: 'bad' }] }));
  });

  it('loads a TypeScript config with no bundler or loader', async () => {
    const loaded = await loadConfig({ from: path.join(root, 'project') });
    expect(loaded.config.rules[0]!.id).toBe('ts-config');
    expect(loaded.root).toBe(path.join(root, 'project'));
  });

  it('searches upward, and globs stay relative to the config directory', async () => {
    const fromRoot = await loadConfig({ from: path.join(root, 'project') });
    const fromNested = await loadConfig({ from: path.join(root, 'project/nested/deep') });
    expect(fromNested.filepath).toBe(fromRoot.filepath);

    const a = await scan(toScanOptions(fromRoot));
    const b = await scan(toScanOptions(fromNested));
    expect(b).toEqual(a);
    expect(a.map((finding) => finding.file)).toEqual(['docs/page.md']);
  });

  it('loads json and a package.json key', async () => {
    expect((await loadConfig({ from: path.join(root, 'json-project') })).config.rules[0]!.id).toBe(
      'json',
    );
    const fromPackage = await loadConfig({ from: path.join(root, 'pkg-project') });
    expect(fromPackage.config.rules[0]!.id).toBe('from-package');
    expect(fromPackage.filepath.endsWith('package.json')).toBe(true);
  });

  it('takes an explicit path over the search', async () => {
    const loaded = await loadConfig({
      from: root,
      configPath: path.join(root, 'json-project/charcheck.config.json'),
    });
    expect(loaded.config.rules[0]!.id).toBe('json');
  });

  it('reports a missing explicit path as a config error', async () => {
    await expect(loadConfig({ from: root, configPath: 'nope.json' })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it('validates what it loads', async () => {
    await expect(loadConfig({ from: path.join(root, 'bad-project') })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it('suggests a starter config when there is none', async () => {
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'charcheck-none-'));
    try {
      await expect(loadConfig({ from: isolated })).rejects.toBeInstanceOf(ConfigNotFoundError);
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });
});

describe('presets', () => {
  it('take their targeting from the caller', () => {
    const rules = noAiPunctuation({ include: ['docs/**/*.md'], exclude: ['**/CHANGELOG.md'] });
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.include).toEqual(['docs/**/*.md']);
      expect(rule.exclude).toEqual(['**/CHANGELOG.md']);
      expect(rule.chars?.length).toBeGreaterThan(0);
    }
    expect(rules.flatMap((rule) => rule.chars ?? [])).toContain(EM_DASH);
  });

  it('can be prefixed and scoped, so one repo can run them twice', () => {
    const rules = invisibles({ include: ['src/**/*.ts'], scope: 'strings', idPrefix: 'code' });
    expect(rules.every((rule) => rule.id.startsWith('code/'))).toBe(true);
    expect(rules.every((rule) => rule.scope === 'strings')).toBe(true);
    expect(rules.flatMap((rule) => rule.chars ?? [])).toContain(ZERO_WIDTH_SPACE);
  });

  it('produce configs that validate', () => {
    expect(
      validateConfig({
        rules: [
          ...noAiPunctuation({ include: ['**/*.md'] }),
          ...invisibles({ include: ['**/*.md'] }),
        ],
      }),
    ).toBeTruthy();
  });
});
