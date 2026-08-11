import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EM_DASH, ZERO_WIDTH_SPACE } from '../src/chars.js';
import { EXIT_OK, EXIT_USAGE, run } from '../src/cli.js';
import type { CliIo } from '../src/cli.js';
import { createGlobAnonymizer } from '../src/report/anonymize.js';

describe('glob anonymization', () => {
  it('renames directory segments and keeps everything else', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('site/.vitepress/**/*.vue')).toBe('dir1/.dir2/**/*.vue');
  });

  it('keeps a leading dot, which is the signal the pattern exists to carry', () => {
    const anonymize = createGlobAnonymizer();
    // A dotted directory is only entered when a pattern names it, so losing the dot would
    // hide the commonest cause of a rule matching nothing.
    expect(anonymize('.github/workflows/*.yml')).toBe('.dir1/dir2/*.yml');
  });

  it('keeps a double star distinct from a single one', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('docs/**/*.md')).toBe('dir1/**/*.md');
    expect(anonymize('docs/*/*.md')).toBe('dir1/*/*.md');
  });

  it('keeps the segment count', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('a/b/c/d.md')).toBe('dir1/dir2/dir3/file4.md');
  });

  it('renames inside a brace expansion and keeps the braces', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('{guide,api}/**')).toBe('{dir1,dir2}/**');
  });

  it('keeps an extension, including a braced one', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('src/**/*.{ts,js}')).toBe('dir1/**/*.{ts,js}');
    // The counter runs on from the pattern above, since one renamer covers a whole report.
    expect(anonymize('acme/notes.test.ts')).toBe('dir2/file3.test.ts');
  });

  it('leaves a virtual pattern alone, since it names no directory', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('<commit-msg>')).toBe('<commit-msg>');
  });

  it('gives two rules the same placeholder for a shared directory', () => {
    const anonymize = createGlobAnonymizer();
    expect(anonymize('docs/**/*.md')).toBe('dir1/**/*.md');
    expect(anonymize('docs/api/*.md')).toBe('dir1/dir2/*.md');
    expect(anonymize('other/**/*.md')).toBe('dir3/**/*.md');
  });

  it('is idempotent, so anonymizing an anonymized report changes nothing', () => {
    const first = createGlobAnonymizer();
    const patterns = ['site/.vitepress/**/*.vue', 'site/theme/*.ts', '{a,b}/c.md', '<commit-msg>'];
    const once = patterns.map(first);

    const second = createGlobAnonymizer();
    expect(once.map(second)).toEqual(once);
  });
});

let root: string;

interface Captured {
  code: number;
  out: string;
  err: string;
}

async function write(relative: string, contents: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function cli(argv: string[], cwd = root): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    color: false,
  };
  const code = await run(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const CONFIG = JSON.stringify({
  rules: [
    {
      id: 'no-em-dash-in-acme-docs',
      chars: [EM_DASH],
      scope: 'markdown',
      message: 'Use a comma, a colon, or reword.',
      include: ['acme/**/*.md'],
      exclude: ['acme/vendor/**'],
      fix: '-',
    },
    {
      id: 'no-invisibles',
      chars: [ZERO_WIDTH_SPACE],
      include: ['<commit-msg>'],
      severity: 'warn',
    },
  ],
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-report-'));
  await write('charcheck.config.json', CONFIG);
  await write('acme/one.md', 'clean\n');
  await write('acme/two.md', `prose ${EM_DASH} here\n`);
  await write('acme/vendor/three.md', `excluded ${EM_DASH} here\n`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('--report-issue', () => {
  it('reports the versions, the rules as resolved, and the placeholders', async () => {
    const result = await cli(['--report-issue']);

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('### charcheck version');
    expect(result.out).toContain('### Node version');
    expect(result.out).toContain('### Operating system');
    expect(result.out).toContain('### Minimal reproduction');
    expect(result.out).toContain('#### rule 1');
    expect(result.out).toContain('- scope: `markdown`');
    expect(result.out).toContain('- fix: a replacement string');
  });

  it('counts the files each rule matched, which is the fact a config cannot show', async () => {
    const result = await cli(['--report-issue']);

    // Two of the three, because the third is excluded. The count is the whole reason the
    // command exists: a rule reaching nothing reports a clean run and exits 0.
    expect(result.out).toContain('- matched: 2 file(s)');
    expect(result.out).toContain('- matched: not a file rule');
  });

  it('anonymizes the globs and drops the ids and messages', async () => {
    const result = await cli(['--report-issue']);

    expect(result.out).toContain('- include: `dir1/**/*.md`');
    expect(result.out).toContain('- exclude: `dir1/dir2/**`');
    expect(result.out).not.toContain('acme');
    expect(result.out).not.toContain('no-em-dash-in-acme-docs');
    expect(result.out).not.toContain('reword');
  });

  it('reads an empty exclude as none, the same as an absent one', async () => {
    await write(
      'charcheck.config.json',
      JSON.stringify({
        rules: [
          { id: 'absent', chars: [ZERO_WIDTH_SPACE], include: ['acme/**/*.md'] },
          { id: 'empty', chars: [ZERO_WIDTH_SPACE], include: ['acme/**/*.md'], exclude: [] },
        ],
      }),
    );

    const result = await cli(['--report-issue']);

    // Two configs that behave alike have to read alike. A key printed with nothing after it
    // reads as a truncation, in the one output whose job is to be scanned for anomalies.
    expect(result.out).not.toContain('- exclude: \n');
    expect([...result.out.matchAll(/- exclude: none/g)]).toHaveLength(2);
  });

  it('names the config by its basename alone', async () => {
    const result = await cli(['--report-issue']);

    expect(result.out).toContain('`charcheck.config.json`');
    expect(result.out).not.toContain(root);
  });

  it('writes the banned characters as escapes, not as themselves', async () => {
    const result = await cli(['--report-issue']);

    // The report is about characters a clipboard eats. Printing one would leave a maintainer
    // reading a different character than the reporter found.
    expect(result.out).toContain('- chars: `\\u2014`');
    expect(result.out).not.toContain(EM_DASH);
    expect(result.out).not.toContain(ZERO_WIDTH_SPACE);
  });

  it('keeps the real globs under --verbatim, and says that it did', async () => {
    const result = await cli(['--report-issue', '--verbatim']);

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('- include: `acme/**/*.md`');
    expect(result.out).toContain('--verbatim');
  });

  it('exits 0 even where a scan would find something', async () => {
    const findings = await cli([]);
    expect(findings.code).not.toBe(EXIT_OK);

    const result = await cli(['--report-issue']);
    expect(result.code).toBe(EXIT_OK);
  });

  it('refuses a flag it would otherwise ignore', async () => {
    for (const flag of ['--fix', '--quiet', '--staged', '--format', '--max-warnings']) {
      const argv =
        flag === '--format'
          ? ['--report-issue', '--format', 'json']
          : flag === '--max-warnings'
            ? ['--report-issue', '--max-warnings', '3']
            : ['--report-issue', flag];
      const result = await cli(argv);

      expect(result.code).toBe(EXIT_USAGE);
      expect(result.err).toContain(`drop ${flag}`);
    }
  });

  it('refuses positional paths, which select nothing here', async () => {
    const result = await cli(['--report-issue', 'acme']);

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('drop the positional paths');
  });

  it('refuses --verbatim on its own, rather than ignoring it', async () => {
    const result = await cli(['--verbatim']);

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('--verbatim only means something alongside --report-issue');
  });
});
