import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BYTE_ORDER_MARK, EM_DASH, ZERO_WIDTH_SPACE } from '../src/chars.js';
import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE, run } from '../src/cli.js';
import type { CliIo } from '../src/cli.js';

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
      id: 'no-em-dash',
      chars: [EM_DASH],
      include: ['docs/**/*.md'],
      fix: '-',
    },
    {
      id: 'no-zero-width',
      chars: [ZERO_WIDTH_SPACE],
      include: ['docs/**/*.md'],
      severity: 'warn',
    },
  ],
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-cli-'));
  await write('charcheck.config.json', CONFIG);
  await write('docs/bad.md', `first line\nprose ${EM_DASH} here\n`);
  await write('docs/warn.md', `invisible ${ZERO_WIDTH_SPACE} here\n`);
  await write('docs/clean.md', 'nothing wrong\n');
  await write('other/ignored.md', `outside ${EM_DASH} the globs\n`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('usage', () => {
  it('prints help and exits clean', async () => {
    const result = await cli(['--help']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('charcheck [paths...]');
    expect(result.out).toContain('--fix');
    expect(result.out).toContain('Exit codes');
  });

  it('prints a version', async () => {
    const result = await cli(['--version']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects an unknown flag and an unknown format with exit 2', async () => {
    const unknown = await cli(['--nope']);
    expect(unknown.code).toBe(EXIT_USAGE);
    expect(unknown.err).toContain('--help');

    const format = await cli(['--format', 'xml']);
    expect(format.code).toBe(EXIT_USAGE);
    expect(format.err).toContain('unknown format');
  });

  it('rejects a non-numeric max-warnings', async () => {
    const result = await cli(['--max-warnings', 'lots']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('whole number');
  });

  it('refuses baseline flags that contradict each other', async () => {
    const both = await cli(['--baseline', '--no-baseline']);
    expect(both.code).toBe(EXIT_USAGE);
    expect(both.err).toContain('opposites');

    const strict = await cli(['--no-baseline', '--baseline-strict']);
    expect(strict.code).toBe(EXIT_USAGE);
    expect(strict.err).toContain('--baseline-strict');
  });

  it('refuses to write a baseline from a run over part of the tree', async () => {
    const staged = await cli(['--baseline-write', '--staged']);
    expect(staged.code).toBe(EXIT_USAGE);
    expect(staged.err).toContain('part of the tree');

    const paths = await cli(['--baseline-write', 'docs']);
    expect(paths.code).toBe(EXIT_USAGE);
    expect(paths.err).toContain('part of the tree');
  });

  it('refuses a baseline flag for a commit message', async () => {
    const result = await cli(['--commit-msg', 'MSG', '--baseline']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('no baseline');
  });

  it('reports a missing config with exit 2 and a starter config', async () => {
    const bare = await mkdtemp(path.join(os.tmpdir(), 'charcheck-bare-'));
    try {
      const result = await cli([], bare);
      expect(result.code).toBe(EXIT_USAGE);
      expect(result.err).toContain('defineConfig');
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('reports an invalid config with exit 2, not as a violation', async () => {
    await write('charcheck.config.json', JSON.stringify({ rules: [{ id: 'broken' }] }));
    const result = await cli([]);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('Invalid charcheck config');
  });
});

describe('reporting', () => {
  it('exits 1 and shows position, excerpt, caret and rule id', async () => {
    const result = await cli([]);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('docs/bad.md:2:7');
    expect(result.out).toContain(`prose ${EM_DASH} here`);
    expect(result.out).toContain('^');
    expect(result.out).toContain('no-em-dash');
    expect(result.out).toContain('1 error');
  });

  it('names an invisible character, which the excerpt cannot show', async () => {
    const result = await cli([]);
    expect(result.out).toContain('U+200B');
  });

  it('exits 0 and says so when nothing is found', async () => {
    const result = await cli(['docs/clean.md']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('No banned characters found');
  });

  it('emits json with a schema version and a summary', async () => {
    const result = await cli(['--format', 'json']);
    const report = JSON.parse(result.out) as {
      schemaVersion: number;
      findings: { ruleId: string; file: string }[];
      summary: { errors: number; warnings: number; fixable: number };
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.summary).toMatchObject({ errors: 1, warnings: 1, fixable: 1 });
    expect(report.findings.map((finding) => finding.file)).toEqual(['docs/bad.md', 'docs/warn.md']);
  });

  it('emits sarif that parses, with one rule per rule id', async () => {
    const result = await cli(['--format', 'sarif']);
    const report = JSON.parse(result.out) as {
      version: string;
      runs: { tool: { driver: { rules: { id: string }[] } }; results: unknown[] }[];
    };
    expect(report.version).toBe('2.1.0');
    expect(report.runs[0]!.tool.driver.rules.map((rule) => rule.id)).toEqual([
      'no-em-dash',
      'no-zero-width',
    ]);
    expect(report.runs[0]!.results).toHaveLength(2);
  });

  it('keeps json on stdout with nothing else mixed in', async () => {
    const result = await cli(['--format', 'json']);
    expect(() => JSON.parse(result.out)).not.toThrow();
    expect(result.err).toBe('');
  });
});

describe('filtering and exit codes', () => {
  it('limits a run to the given paths, still through the globs', async () => {
    const result = await cli(['docs/warn.md', 'other/ignored.md']);
    expect(result.out).toContain('docs/warn.md');
    expect(result.out).not.toContain('other/ignored.md');
    expect(result.out).not.toContain('docs/bad.md');
  });

  it('drops warnings with --quiet but still exits on the error', async () => {
    const result = await cli(['--quiet']);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).not.toContain('no-zero-width');
  });

  /**
   * --quiet used to remove the warnings from the count as well as from the list, so a run
   * failing on --max-warnings printed that nothing was wrong. The exit code was then
   * impossible to act on, which is exactly the ratchet the flag exists to make quiet.
   */
  describe('--quiet', () => {
    it('still counts the warnings it does not list', async () => {
      const result = await cli(['docs/warn.md', '--quiet']);
      expect(result.code).toBe(EXIT_OK);
      expect(result.out).not.toContain('no-zero-width');
      expect(result.out).toContain('1 warning');
      expect(result.out).not.toContain('No banned characters found');
    });

    it('keeps the json summary whole while narrowing its findings', async () => {
      const result = await cli(['docs/warn.md', '--quiet', '--format', 'json']);
      const report = JSON.parse(result.out) as {
        findings: unknown[];
        summary: { warnings: number; files: number };
      };
      expect(report.findings).toEqual([]);
      expect(report.summary.warnings).toBe(1);
      expect(report.summary.files).toBe(1);
    });

    it('says nothing when there is nothing to say', async () => {
      const result = await cli(['docs/clean.md', '--quiet']);
      expect(result.code).toBe(EXIT_OK);
      expect(result.out).toContain('No banned characters found');
    });
  });

  it('exits 0 for warnings alone, and 1 once they exceed --max-warnings', async () => {
    const clean = await cli(['docs/warn.md']);
    expect(clean.code).toBe(EXIT_OK);

    const limited = await cli(['docs/warn.md', '--max-warnings', '0']);
    expect(limited.code).toBe(EXIT_FINDINGS);

    const allowed = await cli(['docs/warn.md', '--max-warnings', '1']);
    expect(allowed.code).toBe(EXIT_OK);
  });

  it('names the threshold it crossed, on stderr, where json can still be parsed', async () => {
    const result = await cli([
      'docs/warn.md',
      '--quiet',
      '--format',
      'json',
      '--max-warnings',
      '0',
    ]);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.err).toContain('--max-warnings');
    expect(result.err).toContain('1 warning, 1 over');
    expect(() => JSON.parse(result.out)).not.toThrow();
  });

  it('reports a rule whose scope needs an absent parser as a config error', async () => {
    await write(
      'charcheck.config.json',
      JSON.stringify({
        rules: [{ id: 'bad-scope', chars: [EM_DASH], scope: 'markup', include: ['docs/**/*.md'] }],
      }),
    );
    const result = await cli([]);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('markup');
  });
});

describe('--fix', () => {
  it('rewrites what it can, reports the rest, and counts', async () => {
    const result = await cli(['--fix']);
    expect(await readFile(path.join(root, 'docs/bad.md'), 'utf8')).toBe(
      'first line\nprose - here\n',
    );
    expect(result.out).toContain('Fixed 1 finding');
    expect(result.out).toContain('Read the diff');
    // The warning has no fix, so it survives and is still reported.
    expect(result.out).toContain('no-zero-width');
    expect(result.code).toBe(EXIT_OK);
  });

  it('preserves CRLF and a byte order mark', async () => {
    const original = `${BYTE_ORDER_MARK}a ${EM_DASH} b\r\nsecond line\r\n`;
    await write('docs/crlf.md', original);
    await cli(['--fix', 'docs/crlf.md']);
    expect(await readFile(path.join(root, 'docs/crlf.md'), 'utf8')).toBe(
      `${BYTE_ORDER_MARK}a - b\r\nsecond line\r\n`,
    );
  });

  it('leaves a file alone when its rule declares no fix', async () => {
    const before = await readFile(path.join(root, 'docs/warn.md'), 'utf8');
    await cli(['--fix', 'docs/warn.md']);
    expect(await readFile(path.join(root, 'docs/warn.md'), 'utf8')).toBe(before);
  });

  it('is idempotent', async () => {
    await cli(['--fix']);
    const once = await readFile(path.join(root, 'docs/bad.md'), 'utf8');
    await cli(['--fix']);
    expect(await readFile(path.join(root, 'docs/bad.md'), 'utf8')).toBe(once);
  });
});

describe('the baseline', () => {
  const withConfig = async (extra: Record<string, unknown>): Promise<void> => {
    await write(
      'charcheck.config.json',
      JSON.stringify({ ...(JSON.parse(CONFIG) as object), ...extra }),
    );
  };
  const baseline = async (relative = 'charcheck-baseline.json'): Promise<unknown> =>
    JSON.parse(await readFile(path.join(root, relative), 'utf8'));

  it('records the run, and the next run has nothing new to say', async () => {
    const written = await cli(['--baseline-write']);
    expect(written.code).toBe(EXIT_OK);
    expect(written.err).toContain('recorded 2 findings');
    expect(await baseline()).toEqual({
      version: 1,
      entries: [
        { file: 'docs/bad.md', ruleId: 'no-em-dash', context: expect.any(String), ordinal: 0 },
        { file: 'docs/warn.md', ruleId: 'no-zero-width', context: expect.any(String), ordinal: 0 },
      ],
    });

    const after = await cli(['--baseline']);
    expect(after.code).toBe(EXIT_OK);
    expect(after.out).toContain('No new banned characters found.');
    expect(after.out).toContain('2 findings accounted for by the baseline');
  });

  it('still fails on a finding it does not hold', async () => {
    await cli(['--baseline-write']);
    await write('docs/fresh.md', `new ${EM_DASH} prose\n`);

    const result = await cli(['--baseline']);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out).toContain('docs/fresh.md');
    expect(result.out).not.toContain('docs/bad.md');
    expect(result.out).toContain('2 findings accounted for by the baseline');
  });

  it('survives the file being re-wrapped around a recorded finding', async () => {
    await cli(['--baseline-write']);
    await write('docs/bad.md', `first\nline\nprose\n${EM_DASH}\nhere\n`);

    const result = await cli(['--baseline']);
    expect(result.code).toBe(EXIT_OK);
  });

  it('is on when the config says so, and --no-baseline turns it off again', async () => {
    await cli(['--baseline-write']);
    await withConfig({ baseline: true });

    expect((await cli([])).code).toBe(EXIT_OK);
    expect((await cli(['--no-baseline'])).code).toBe(EXIT_FINDINGS);
  });

  it('takes a path from the config, creating what it needs', async () => {
    await withConfig({ baseline: 'ci/known.json' });

    expect((await cli(['--baseline-write'])).code).toBe(EXIT_OK);
    expect(await baseline('ci/known.json')).toMatchObject({ version: 1 });
    expect((await cli([])).code).toBe(EXIT_OK);
  });

  it('reports an entry whose finding is gone, and fails on it only under --baseline-strict', async () => {
    await cli(['--baseline-write']);
    await write('docs/bad.md', 'first line\nprose - here\n');

    const relaxed = await cli(['--baseline']);
    expect(relaxed.code).toBe(EXIT_OK);
    expect(relaxed.err).toContain('1 baseline entry');
    expect(relaxed.err).toContain('no longer match a finding');

    const strict = await cli(['--baseline-strict']);
    expect(strict.code).toBe(EXIT_FINDINGS);
    expect(strict.err).toContain('--baseline-strict');
  });

  it('still fixes a recorded finding, and drops the entry it just made unmatchable', async () => {
    await cli(['--baseline-write']);

    const result = await cli(['--fix', '--baseline']);
    expect(result.code).toBe(EXIT_OK);
    expect(await readFile(path.join(root, 'docs/bad.md'), 'utf8')).toBe(
      'first line\nprose - here\n',
    );
    expect(result.err).toContain('dropped 1 entry');
    expect((await baseline()) as { entries: unknown[] }).toMatchObject({
      entries: [{ file: 'docs/warn.md' }],
    });

    // Nothing left to say about it: the entry is gone rather than reported forever.
    const after = await cli(['--baseline-strict']);
    expect(after.code).toBe(EXIT_OK);
    expect(after.err).not.toContain('no longer match');
  });

  it('leaves entries alone for the files a fix run never looked at', async () => {
    await cli(['--baseline-write']);

    const result = await cli(['--fix', '--baseline', 'docs/bad.md']);
    expect(result.code).toBe(EXIT_OK);
    expect((await baseline()) as { entries: unknown[] }).toMatchObject({
      entries: [{ file: 'docs/warn.md' }],
    });
  });

  it('subtracts what it accounts for before --max-warnings', async () => {
    await cli(['--baseline-write']);
    const result = await cli(['--baseline', '--max-warnings', '0']);
    expect(result.code).toBe(EXIT_OK);
  });

  it('says on stderr what a machine-readable report leaves out', async () => {
    await cli(['--baseline-write']);
    const result = await cli(['--baseline', '--format', 'json']);
    expect(JSON.parse(result.out)).toMatchObject({ findings: [] });
    expect(result.err).toContain('2 findings accounted for by the baseline');
  });

  it('says when there is no baseline to read', async () => {
    const result = await cli(['--baseline']);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.err).toContain('no baseline at');
  });

  it('refuses a baseline it cannot read rather than treating it as empty', async () => {
    await write('charcheck-baseline.json', JSON.stringify({ version: 99, entries: [] }));
    const result = await cli(['--baseline']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toContain('version');
  });
});

describe('working directory', () => {
  it('gives the same result from a subdirectory', async () => {
    const fromRoot = await cli(['--format', 'json']);
    const fromNested = await cli(['--format', 'json'], path.join(root, 'docs'));
    expect(fromNested.out).toBe(fromRoot.out);
  });

  it('takes an explicit config path', async () => {
    const result = await cli(['--config', 'charcheck.config.json', '--format', 'json']);
    expect(result.code).toBe(EXIT_FINDINGS);
  });
});
