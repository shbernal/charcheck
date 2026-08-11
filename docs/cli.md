# Command line

```
charcheck [paths...]

  --config <path>       Use this config instead of searching upward.
  --fix                 Rewrite fixable findings, then report what is left.
  --staged              Check the staged content of staged files.
  --commit-msg <file>   Check a commit message.
  --format <fmt>        pretty (default), json, or sarif.
  --max-warnings <n>    Exit non-zero when warnings exceed n.
  --quiet               List errors only. Warnings are still counted.
  --no-color            Disable colour.
  --version, --help
```

## Positional paths

Positional paths are **intersected** with each rule's `include`, never substituted for it,
so naming a path that no rule targets scans nothing rather than everything.

That is the safe direction to fail. The alternative, treating a path as a fresh target set,
would mean `charcheck src/` silently applying prose rules to source files.

## Exit codes

| Exit code | Meaning                                      |
| --------- | -------------------------------------------- |
| `0`       | Clean                                        |
| `1`       | Findings, or warnings above `--max-warnings` |
| `2`       | A usage or config error                      |

`2` is kept distinct so a broken config in CI is never mistaken for a real violation.

## `--quiet` and `--max-warnings`

`--quiet` narrows the **list**, never the count. Warnings stop being enumerated, and go on
being summarized, reported in `summary` of the JSON report, and used to decide
`--max-warnings`. The two have to agree: a run that hid its warnings and then failed on
their number printed that nothing was wrong, and no consumer could act on the exit code.

That pairing is what makes the flag usable as a ratchet over an existing backlog. Freeze
the count, let it shrink but not grow, and read one summary line instead of the whole
backlog on every CI run:

```bash
charcheck --quiet --max-warnings 684
```

Crossing the threshold is reported on stderr, naming the limit and the distance past it, so
the exit code is diagnosable in every format:

```
charcheck: 685 warnings, 1 over the --max-warnings limit of 684.
```

## Output formats

`json` and `sarif` go to stdout with diagnostics on stderr, so piping to a parser needs no
filtering. The JSON report carries a `schemaVersion`.

Under `--quiet`, `findings` holds the errors alone while `summary` still counts everything,
which is the same split the pretty report makes between its list and its last line.

## `--staged`

Reads each file's **staged content from the index**, not from the working tree. A hook that
reports a violation the commit does not contain, or blames you for an edit you deliberately
left unstaged, is a hook you will turn off within a week.

With `--fix` it rewrites the working tree and then stages exactly the files it changed, so
the commit carries the fix. That is a real change to your index, stated here rather than
discovered.

## `--commit-msg`

Git passes the message file as `$1`. Comment lines are ignored, as is everything below the
scissors line, which under `commit.verbose` is the entire diff. Messages git generates for
merges, reverts, fixups and squashes are skipped.

`--fix` is refused here. Rewriting your commit message under you is worse than failing.
