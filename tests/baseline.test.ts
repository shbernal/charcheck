/**
 * The baseline: what counts as the same finding across an edit, and what a run is allowed
 * to fail on because of it.
 *
 * Two properties matter more than the rest, and both are here because getting either wrong
 * gets the file deleted by its users. Re-wrapping a paragraph must not invalidate anything,
 * and a pull request that only fixes findings must not fail.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BASELINE_VERSION,
  BaselineError,
  contextFor,
  entriesFor,
  partition,
  readBaseline,
  serializeBaseline,
  writeBaseline,
} from '../src/baseline.js';
import type { Baseline, BaselineEntry } from '../src/baseline.js';
import { BYTE_ORDER_MARK, EM_DASH } from '../src/chars.js';
import { scanText } from '../src/scan.js';
import type { Finding } from '../src/types.js';
import { rule } from './helpers.js';

const FILE = 'docs/a.md';

async function findingsIn(text: string, file = FILE): Promise<Finding[]> {
  return scanText(text, file, [rule({ id: 'no-em-dash', fix: '-' })], { assumeText: true });
}

/** The pairing every caller makes: the findings, and the text they were computed from. */
async function scanned(text: string, file = FILE): Promise<[Finding[], Map<string, string>]> {
  return [await findingsIn(text, file), new Map([[file, text]])];
}

function baselineOf(entries: readonly BaselineEntry[]): Baseline {
  return { version: BASELINE_VERSION, entries: [...entries] };
}

describe('contextFor', () => {
  it('survives a reflow', () => {
    const flat = `one two three ${EM_DASH} four five six seven`;
    const wrapped = `one two\nthree ${EM_DASH} four\nfive six seven`;

    expect(contextFor(flat, flat.indexOf(EM_DASH), 1)).toBe(
      contextFor(wrapped, wrapped.indexOf(EM_DASH), 1),
    );
  });

  it('survives a change beyond the window', () => {
    // The tail has to start past the window to prove anything, which is 40 characters
    // after the match and not one fewer.
    const near = `a ${EM_DASH} b${' word'.repeat(10)}`;
    const far = `${near} and a whole new sentence after it.`;

    expect(contextFor(near, near.indexOf(EM_DASH), 1)).toBe(
      contextFor(far, far.indexOf(EM_DASH), 1),
    );
  });

  it('changes when the text around the match changes', () => {
    const before = `the cat sat ${EM_DASH} on the mat`;
    const after = `the dog sat ${EM_DASH} on the mat`;

    expect(contextFor(before, before.indexOf(EM_DASH), 1)).not.toBe(
      contextFor(after, after.indexOf(EM_DASH), 1),
    );
  });

  it('clamps the window at both ends of the file', () => {
    const short = EM_DASH;
    expect(contextFor(short, 0, 1)).toHaveLength(12);
    expect(contextFor(short, 0, 1)).toBe(contextFor(`\n\n${EM_DASH}\n\n`, 2, 1));
  });
});

describe('entriesFor', () => {
  it('numbers findings that share a window, in offset order', async () => {
    // The same window text twice over, so the hash cannot tell them apart and the ordinal
    // is the only thing that does.
    const line = `a ${EM_DASH} b`;
    const [findings, sources] = await scanned(`${line}\n${line}\n`);
    expect(findings).toHaveLength(2);

    const entries = entriesFor(findings, sources);
    expect(entries.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(entries[0]!.context).toBe(entries[1]!.context);
  });

  it('reads through a byte order mark, which the offsets already exclude', async () => {
    const text = `a ${EM_DASH} b\n`;
    const [plain, plainSources] = await scanned(text);
    const [marked, markedSources] = await scanned(`${BYTE_ORDER_MARK}${text}`);

    expect(entriesFor(marked, markedSources)).toEqual(entriesFor(plain, plainSources));
  });

  it('refuses to record a finding whose file could not be read', async () => {
    const findings = await findingsIn(`a ${EM_DASH} b\n`);

    // A write from a partial scan records a false zero for the files it missed, which is
    // worse than no baseline at all: the file then claims they are known-good.
    expect(() => entriesFor(findings, new Map())).toThrow(BaselineError);
    expect(() => entriesFor(findings, new Map())).toThrow(/was not readable/);
  });

  it('sorts for a readable diff', async () => {
    const text = `a ${EM_DASH} b\n`;
    const findings = [...(await findingsIn(text, 'z.md')), ...(await findingsIn(text, 'a.md'))];
    const sources = new Map([
      ['z.md', text],
      ['a.md', text],
    ]);

    expect(entriesFor(findings, sources).map((entry) => entry.file)).toEqual(['a.md', 'z.md']);
  });
});

describe('partition', () => {
  it('accounts for a finding that has not moved', async () => {
    const [findings, sources] = await scanned(`a ${EM_DASH} b\n`);
    const baseline = baselineOf(entriesFor(findings, sources));

    const result = partition(findings, sources, baseline);
    expect(result.reported).toEqual([]);
    expect(result.baselined).toHaveLength(1);
    expect(result.stale).toEqual([]);
  });

  it('reports a finding the baseline never knew about', async () => {
    const [recorded, recordedSources] = await scanned(`a ${EM_DASH} b\n`);
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    const [findings, sources] = await scanned(`a ${EM_DASH} b\nsomething ${EM_DASH} new\n`);
    const result = partition(findings, sources, baseline);

    expect(result.reported).toHaveLength(1);
    expect(result.reported[0]!.line).toBe(2);
    expect(result.baselined).toHaveLength(1);
  });

  it('does not fail a change that only fixed things', async () => {
    // Two findings inside one window: fixing either rewrites the other's context, so tier
    // one cannot match what is left. This is the case that decides whether the file is
    // usable, since a pull request that only removed a banned character must not go red.
    const [recorded, recordedSources] = await scanned(`a ${EM_DASH} b ${EM_DASH} c\n`);
    expect(recorded).toHaveLength(2);
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    const [findings, sources] = await scanned(`a - b ${EM_DASH} c\n`);
    const result = partition(findings, sources, baseline);

    expect(result.reported).toEqual([]);
    expect(result.baselined).toHaveLength(1);
    expect(result.stale).toHaveLength(1);
  });

  it('fails when a file and rule hold more findings than were recorded', async () => {
    const [recorded, recordedSources] = await scanned(`a ${EM_DASH} b\n`);
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    const [findings, sources] = await scanned(`a ${EM_DASH} b ${EM_DASH} c\n`);
    const result = partition(findings, sources, baseline);

    expect(result.baselined).toHaveLength(1);
    expect(result.reported).toHaveLength(1);
  });

  it('spends an exact match before a count match', async () => {
    // Both findings are still there and one has moved. The entry the unmoved finding
    // matches exactly must not have been spent on the moved one first.
    const [recorded, recordedSources] = await scanned(
      `first ${EM_DASH} here\n\n\n\n\n\n\n\n\nsecond ${EM_DASH} there\n`,
    );
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    const [findings, sources] = await scanned(
      `first ${EM_DASH} here\n\n\n\n\n\n\n\n\nsecond ${EM_DASH} elsewhere\n`,
    );
    const result = partition(findings, sources, baseline);

    expect(result.reported).toEqual([]);
    expect(result.baselined).toHaveLength(2);
    expect(result.stale).toEqual([]);
  });

  it('matches by count when the file could not be read', async () => {
    const [recorded, recordedSources] = await scanned(`a ${EM_DASH} b\n`);
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    // An ordinary run must not fail because one file was unreadable this time.
    const result = partition(recorded, new Map(), baseline);
    expect(result.reported).toEqual([]);
    expect(result.baselined).toHaveLength(1);
  });

  it('reports an entry whose finding is gone', async () => {
    const [recorded, recordedSources] = await scanned(`a ${EM_DASH} b\n`);
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    const result = partition([], new Map(), baseline);
    expect(result.stale).toEqual(baseline.entries);
  });

  it('leaves an entry alone when this run did not scan its file', async () => {
    // The `--staged` case. Every file outside the staged set would otherwise read as fixed,
    // and the hook would print the whole repository on every commit.
    const [recorded, recordedSources] = await scanned(`a ${EM_DASH} b\n`, 'unstaged.md');
    const baseline = baselineOf(entriesFor(recorded, recordedSources));

    const result = partition([], new Map(), baseline, {
      kind: 'files',
      files: new Set(['staged.md']),
    });

    expect(result.stale).toEqual([]);
  });
});

describe('the file', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'charcheck-baseline-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const at = (name: string): string => path.join(root, name);

  it('writes one entry per line', async () => {
    const text = serializeBaseline([
      { file: 'b.md', ruleId: 'no-em-dash', context: 'ffffffffffff', ordinal: 0 },
      { file: 'a.md', ruleId: 'no-em-dash', context: '000000000000', ordinal: 0 },
    ]);

    expect(text.split('\n').filter((line) => line.includes('ruleId'))).toHaveLength(2);
    expect(text.indexOf('a.md')).toBeLessThan(text.indexOf('b.md'));
    expect(text.endsWith('\n')).toBe(true);
  });

  it('round-trips through disk', async () => {
    const [findings, sources] = await scanned(`a ${EM_DASH} b\n`);
    const entries = entriesFor(findings, sources);

    await writeBaseline(at('round-trip.json'), entries);
    expect(await readBaseline(at('round-trip.json'))).toEqual({
      version: BASELINE_VERSION,
      entries,
    });
  });

  it('writes an empty baseline as an empty baseline', async () => {
    await writeBaseline(at('empty.json'), []);
    expect(await readBaseline(at('empty.json'))).toEqual({
      version: BASELINE_VERSION,
      entries: [],
    });
  });

  it('reads a missing file as no baseline rather than an empty one', async () => {
    expect(await readBaseline(at('absent.json'))).toBeUndefined();
  });

  it('names the version it cannot read', async () => {
    await writeFile(at('future.json'), '{"version": 2, "entries": []}', 'utf8');

    await expect(readBaseline(at('future.json'))).rejects.toThrow(BaselineError);
    await expect(readBaseline(at('future.json'))).rejects.toThrow(/version 2/);
  });

  it('refuses a malformed file rather than reading it as empty', async () => {
    // Read as empty, every recorded finding comes back as new, and the run fails on
    // findings the repository already accepted.
    await writeFile(at('broken.json'), '{"version": 1, "entries": [{"file": "a.md"}]}', 'utf8');
    await expect(readBaseline(at('broken.json'))).rejects.toThrow(/entry 0 has no ruleId/);

    await writeFile(at('garbage.json'), 'not json', 'utf8');
    await expect(readBaseline(at('garbage.json'))).rejects.toThrow(/not valid JSON/);
  });
});
