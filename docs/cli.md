# Command line

```
charcheck [paths...]

  --config <path>       Use this config instead of searching upward.
  --fix                 Rewrite fixable findings, then report what is left.
  --staged              Check the staged content of staged files.
  --commit-msg <file>   Check a commit message.
  --format <fmt>        pretty (default), json, or sarif.
  --max-warnings <n>    Exit non-zero when warnings exceed n.
  --max-suppressions <n>
                        Exit non-zero when suppressed findings exceed n.
  --quiet               List errors only. Warnings are still counted.
  --baseline            Report only the findings the baseline does not hold.
  --no-baseline         Ignore the baseline for one run.
  --baseline-write      Record this run's findings as the baseline.
  --baseline-strict     Also fail on an entry whose finding is gone.
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

A path may name a file or a directory, and a directory selects every file under it. When a
path reaches nothing the run says so on stderr rather than reporting a clean tree:

```
path "src/generated" matched no files that any rule targets. Positional paths are
intersected with each rule's include globs, never substituted for them.
```

## Exit codes

| Exit code | Meaning                                       |
| --------- | --------------------------------------------- |
| `0`       | Clean                                         |
| `1`       | Findings, or a count above its `--max-` limit |
| `2`       | A usage or config error, or an unfinished run |

`2` is kept distinct so a broken config in CI is never mistaken for a real violation. The two
runs that earn it without a usage error are the ones where the tool did not finish its job:
a file a rule targets that no scope could read, and fixes that never stopped changing. Both
say so on stderr.

Findings win when both are true. A run that reported an error and also failed to read a file
exits `1`, because the error is the more actionable of the two answers. What the unfinished
run adds is on stderr either way, printed after the report and before anything decides the
code, so `1` is never the whole story in silence.

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

## Suppression counts

A [suppression comment](configuration.md#suppressions) is the one hole you open in your own
check on purpose. Every run says how many findings went through it, so a silenced run stops
looking like a clean one:

```
No banned characters found.
2 findings suppressed by a marker.
```

With findings of its own, the same number joins the summary line:

```
1 error, 0 warnings, 2 suppressed in 1 file
```

A repository with no markers sees nothing new, which is most of them on most runs.

The findings themselves are **not listed**. A silence somebody wrote deliberately and had
reviewed, re-printed on every run afterwards, is how a team learns to stop reading the last
line. One number answers the question, which is whether anything went quiet.

Where to read it in each format:

| Format   | Where                                                                    |
| -------- | ------------------------------------------------------------------------ |
| `pretty` | The summary line, or its own line when there is nothing else to report   |
| `json`   | `summary.suppressed`, a count beside the others                          |
| `sarif`  | Each one as a result carrying `"suppressions": [{ "kind": "inSource" }]` |

SARIF is the exception because SARIF has a mechanism for exactly this. A viewer already
knows to fold such a result away and code scanning does not raise an alert for it, so the
finding itself is what the format should carry, and the reader decides whether to look.

`--max-suppressions <n>` fails the run once the count passes `n`, in the same shape as
`--max-warnings`, and says so on stderr:

```
charcheck: 12 findings suppressed, 2 over the --max-suppressions limit of 10.
```

That makes the holes a **ratchet** rather than a number to watch: freeze the count where it
is today, let it shrink, and a pull request that opens a new one has to say why. A finding
an error already failed the run on takes precedence, so this line appears when the run would
otherwise have passed.

Suppressed findings are counted, never fixed and never failed on. `--fix` does not rewrite
text a marker exists to leave alone, and the count comes from the last look a run took
rather than from summing its fix passes.

## Output formats

`json` and `sarif` go to stdout with diagnostics on stderr, so piping to a parser needs no
filtering. The JSON report carries a `schemaVersion`.

Under `--quiet`, `findings` holds the errors alone while `summary` still counts everything,
which is the same split the pretty report makes between its list and its last line.

## `--fix`

Rewrites the findings whose rule declares a fix, then reports what is left. Read the diff: a
fix is a guess about prose.

Fixing is a **loop, not a single pass**, because a replacement is arbitrary text and can hold
exactly what another rule bans. A house style that rewrites the em dash to an en dash, beside
a rule that bans the en dash, needs two passes to reach the answer both rules agree on. One
pass would leave the en dash on disk and report it as a finding, so running the same command
again would give a different result. charcheck rewrites, re-scans and rewrites again until
nothing changes.

Two fixes over the same span are applied one per pass. Where a narrower rewrite already
covered a wider fix's text, that wider one is skipped rather than spliced into text it was
not computed against, and the re-scan is what gives it its next chance, judged against the
file as it now reads.

Rules can also disagree permanently, each rewriting what the other just wrote. Nothing can
settle that, so the run stops after ten passes and says so:

```
charcheck: stopped after 10 fix passes with the text still changing, so two rules are
rewriting each other's replacement. The files hold whatever the last pass wrote, which is
one side of that argument rather than a settled result. This run is not a pass.
```

The exit code is then `2` unless the remaining findings already earned `1`. Either way the
run is never reported as a clean fix, which is what stopping quietly on a pass limit would
have done. What to look at is the pair of rules behind the findings that remain.

## `--staged`

Reads each file's **staged content from the index**, not from the working tree. A hook that
reports a violation the commit does not contain, or blames you for an edit you deliberately
left unstaged, is a hook you will turn off within a week.

With `--fix` it rewrites the working tree and then stages exactly the files it changed, so
the commit carries the fix. That is a real change to your index, stated here rather than
discovered. Where the rules need more than one pass, each pass stages before the next one
looks, because the next one reads the index: it would otherwise scan the file as though the
previous pass had never run.

**A file whose working copy differs from what you staged is not fixed at all.** For a file
whose working copy matches what you staged, which is the normal case, there is nothing here
to think about. For a file with unstaged edits on top of what you staged, charcheck says so
and leaves it alone:

```
charcheck: not fixing docs/page.md: it differs from what is staged, and fixing it means
staging the whole file, which would put your unstaged changes there into the commit.
Stage them, stash them, or fix the file without --staged.
```

The reason is the staging rather than the rewrite. `git add` takes a whole file, so fixing
one line of a half-staged file commits every other unstaged change in it. That commit looks
entirely ordinary: nothing is corrupted, nothing is reported, and the work you deliberately
held back is simply in it.

This is decided **per file**, so the other files in the same commit are still fixed and
staged. The held file's findings are reported and still fail the run, which is what a
`--staged` run without `--fix` would have done with them anyway. Stage the edits, stash them,
or fix that file without `--staged`.

Separately and underneath this, every fix is checked against the text it is about to change
and skipped if it no longer matches, which covers a file changing mid-run and any caller of
`applyFixes` that pairs findings with text they were not computed from.

## The baseline flags

`--baseline` reports only what the baseline does not already account for, and `--no-baseline`
ignores the file for one run. `--baseline-write` records the current findings, and
`--baseline-strict` also fails on an entry whose finding is gone. The whole story, including
what is recorded and what still fails a run, is on its own page: [Baseline](baseline.md).

Three combinations are refused rather than half honoured. `--baseline-write` with `--staged`
or a positional path, because a run over part of the tree would record the rest as clean. Any
of them with `--commit-msg`, because a message is not a file and nothing about it can be
recorded against one. And `--baseline` together with `--no-baseline`.

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

The top-level `ignore` is printed above the rules, because it is part of how each of them
resolved: it subtracts from every rule's match set the way that rule's own `exclude` does.
Without it a matched count cannot be reconciled with the globs beside it, and a rule driven
to zero by a broad `ignore` reads exactly like one driven to zero by a wrong `include`.

It is a diagnostic, not a check. It resolves each rule's globs to count what they reach, it
reads no file's content, and it **exits 0** whatever your tree holds. Every other flag either
selects files to read or shapes a report of findings, so combining one with `--report-issue`
is a usage error rather than a flag that quietly does nothing.

### What is anonymized, and why nothing is asked

A glob carries real names. `docs/acme-migration/**` is exactly the pattern that ends up in a
working config, and this tracker is public. So the output is anonymized at the source, always:

| Field                                    | Treatment                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `include`, `exclude`, top-level `ignore` | Names replaced positionally, all glob syntax kept verbatim                      |
| rule `pattern`                           | Literal text replaced positionally, all regular expression syntax kept verbatim |
| rule `id`                                | Replaced by the rule's position: `rule 1`, `rule 2`                             |
| rule `message`                           | Omitted, since it never affects what is matched                                 |
| `scope`, `chars`, `severity`, `fix`      | Verbatim. These are the report                                                  |
| Matched file count                       | Verbatim. A number leaks nothing                                                |
| Config path                              | Its basename alone                                                              |
| Findings and file paths                  | Never included. This reports configuration, not results                         |

The rename is **structure preserving**, because the diagnostic value of a glob is its shape
rather than its words. `site/.vitepress/**/*.vue` becomes `dir1/.dir2/**/*.vue`: a double
star stays distinct from a single one, the segment count stays, brace expansions stay, the
final extension stays, and above all the leading dot stays. Every other dotted part of a name
is a name too, so `*.acme-internal.ts` becomes `*.file1.ts`; only a short list of conventions,
such as the `.d` in `.d.ts` and the `.test` in `.test.ts`, is kept as written. A dotted directory is only entered when
a pattern names it, which is the commonest reason a report gets filed at all. Placeholders
are numbered in order of first appearance and shared across rules, so two rules that name the
same directory still look alike, and running the rename over its own output changes nothing.

A `pattern` gets the same treatment, since `Acme Internal` in a regular expression names a
company exactly as it would in a glob. Its escapes, character classes, quantifiers, anchors
and groups stay as written, along with any banned character written as itself, and each run
of literal text between them becomes `text1`, `text2`, shared across rules. `--verbatim`
prints patterns as written, as it does globs.

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
