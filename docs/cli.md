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
  --report-issue        Print a bug report about charcheck itself.
  --verbatim            With --report-issue: keep the real glob names.
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

## `--report-issue`

Prints the body of a bug report **about charcheck itself**, in the shape the
[agent report form](https://github.com/shbernal/charcheck/issues/new?template=agent-report.yml)
asks for, with the sections only you can write left as bracketed placeholders:

```bash
charcheck --report-issue > /tmp/charcheck-report.md
gh issue create --repo shbernal/charcheck --label agent-reported --label bug \
  --body-file /tmp/charcheck-report.md
```

It collects the charcheck, Node, operating system and peer versions, and then the one thing
you cannot paste, which is **each rule as it resolved**: its scope, its characters, its
globs, whether it carries a fix, and **how many files it actually matched**. A pasted config
hides the two facts that explain nearly every report, namely what the globs reached and which
rules reached nothing at all. A rule matching zero files is usually the whole bug.

It is a diagnostic, not a check. It resolves each rule's globs to count what they reach, it
reads no file's content, and it **exits 0** whatever your tree holds. Every other flag either
selects files to read or shapes a report of findings, so combining one with `--report-issue`
is a usage error rather than a flag that quietly does nothing.

### What is anonymized, and why nothing is asked

A glob carries real names. `docs/acme-migration/**` is exactly the pattern that ends up in a
working config, and this tracker is public. So the output is anonymized at the source, always:

| Field                                          | Treatment                                                  |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `include`, `exclude`                           | Names replaced positionally, all glob syntax kept verbatim |
| rule `id`                                      | Replaced by the rule's position: `rule 1`, `rule 2`        |
| rule `message`                                 | Omitted, since it never affects what is matched            |
| `scope`, `chars`, `pattern`, `severity`, `fix` | Verbatim. These are the report                             |
| Matched file count                             | Verbatim. A number leaks nothing                           |
| Config path                                    | Its basename alone                                         |
| Findings and file paths                        | Never included. This reports configuration, not results    |

The rename is **structure preserving**, because the diagnostic value of a glob is its shape
rather than its words. `site/.vitepress/**/*.vue` becomes `dir1/.dir2/**/*.vue`: a double
star stays distinct from a single one, the segment count stays, brace expansions stay, the
extension stays, and above all the leading dot stays. A dotted directory is only entered when
a pattern names it, which is the commonest reason a report gets filed at all. Placeholders
are numbered in order of first appearance and shared across rules, so two rules that name the
same directory still look alike, and running the rename over its own output changes nothing.

Characters are printed as `\uXXXX` escapes rather than as themselves, for the same reason the
form asks reporters to do it: a zero width space does not survive a clipboard, a browser, or
an editor, so the character that arrives is frequently not the character you found.

There is deliberately **no warning and no approval step**. This command exists to be run by
an agent filing a report unattended, and a safety measure that depends on somebody reading
the output before pasting it is not a safety measure in that case. Anonymizing unconditionally
is the only version of this that holds.

`--verbatim` opts out and prints the globs as written, for a human who knows their patterns
are dull and would rather a maintainer see the real ones. The report says that it was used.
It is never the default and the agent path never needs it.
