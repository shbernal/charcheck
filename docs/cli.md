# Command line

```
charcheck [paths...]

  --config <path>       Use this config instead of searching upward.
  --fix                 Rewrite fixable findings, then report what is left.
  --staged              Check the staged content of staged files.
  --commit-msg <file>   Check a commit message.
  --format <fmt>        pretty (default), json, or sarif.
  --max-warnings <n>    Exit non-zero when warnings exceed n.
  --quiet               Report errors only.
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

## Output formats

`json` and `sarif` go to stdout with diagnostics on stderr, so piping to a parser needs no
filtering. The JSON report carries a `schemaVersion`.

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
