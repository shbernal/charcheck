# Baseline

A repository that is not at zero cannot turn a checker on. The first CI run is red, it stays
red, and the work to get to zero is never the work anyone is doing that week.

A baseline records the findings you already have. The run reports what is new, and only that
fails. Nothing is suppressed and nothing is deleted: the recorded findings are still there,
still fixable, and still counted in the summary.

## Turning it on

Three steps, once:

```bash
charcheck --baseline-write     # records what is there today
git add charcheck-baseline.json && git commit -m "chore: record the charcheck baseline"
charcheck --baseline           # green, and red the moment a new character appears
```

Then put `--baseline` in the CI command, or set the key in the config so every run picks it
up:

```js
export default {
  rules: [...],
  baseline: true,
};
```

The file is committed like a lockfile. It is the record of what the repository agreed to
carry, and a run on a machine that does not have it is a run that reports everything.

## What is recorded

One entry per finding: the file, the rule id, a hash of the text around the match, and an
ordinal that separates two findings whose surroundings read the same.

```json
{
  "version": 1,
  "entries": [
    { "file": "docs/a.md", "ruleId": "no-em-dash", "context": "a1b2c3d4e5f6", "ordinal": 0 }
  ]
}
```

There are no line numbers, deliberately. A line number goes stale on the next edit, so every
unrelated pull request would have to update the file, and inserting a paragraph would
invalidate everything below it. The context hash is taken from a window either side of the
match with every run of whitespace collapsed to one space, which is what makes it survive the
most common edit in a prose repository: re-wrapping the paragraph it sits in.

The file is machine oriented. To see what is in it, run the scan without it.

## What fails a run

A finding is accounted for when an entry matches it exactly, or, once the exact matches are
spent, when its file and rule still have an unused entry left over. The second tier matters:
two findings close together share a window, so fixing one changes the other's hash, and
without it a pull request that only fixed things would fail.

The effect is that a run fails when a file and rule genuinely hold **more** findings than were
recorded, and not otherwise. The scheme is never stricter than counting, and more precise than
counting wherever the text has not moved.

## Entries whose finding is gone

Somebody fixed something, which is the point. It is reported and does not fail the run:

```
charcheck: 1 baseline entry in charcheck-baseline.json no longer matches a finding. Write
the baseline again to drop them.
```

`--baseline-strict` fails on it instead, for a repository that wants the file to stay exact.
Off by default, because it turns a pull request that only fixed things red.

A run that saw part of the tree says nothing about the rest of it. Under `--staged`, and under
positional paths, entries for the files the run did not look at are left alone rather than
being read as fixed, so a commit hook does not report your whole repository on every commit.

## With `--fix`

A recorded finding is still fixable. `--fix` rewrites it like any other, and the entry that no
longer matches anything is dropped from the file, so the fix does not leave a note behind for
every future run to report:

```
charcheck: dropped 1 entry from charcheck-baseline.json that the fixes removed. Commit the
file.
```

The entries that stay are rewritten as the text now reads. Under `--staged` the file is not
staged for you: a hook that adds a file to your commit on its own is worse than one that tells
you what it changed.

## Writing it again

`--baseline-write` replaces the file with what the current run found. It refuses to run over
part of the tree, so `--staged` and positional paths are usage errors, and it refuses when a
file could not be read:

```
charcheck: refusing to write the baseline: 1 file could not be scanned, and would be recorded
as having nothing wrong.
```

Both refusals guard the same thing. A file the run never read has no findings, and recording
that as none is a claim that it is clean, which no later run can tell from the real thing.

## Where the file lives

`charcheck-baseline.json` beside the config file, which is what the globs are relative to.
The `baseline` key takes a path instead, relative to that same directory:

```js
export default {
  rules: [...],
  baseline: 'ci/charcheck-known.json',
};
```

There is no path flag on the command line. `charcheck --baseline src` would have to guess
whether `src` was the baseline or a path to scan, and guessing wrong either way is silent.
`--baseline` and `--no-baseline` turn the config's answer on and off for one run.

## What it is not

A baseline is a record, not a suppression. It says these findings exist and are known, and it
says so per file and rule where anyone can read it in a diff. For a finding that is
**correct** and should never be reported again, use a suppression comment or narrow the rule's
globs, both of which say why at the place it applies. See
[Configuration](configuration.md#suppressions).
