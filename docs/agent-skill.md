# Agent skill

Most configs here are written by an agent, and an agent that hits a charcheck defect does
not see an error. It sees a pass. Nothing throws, nothing is logged, and the natural next
move is to add an `exclude` glob and get on with the task. That silences the bug and the
real findings underneath it at the same time.

`charcheck-upstream` is a skill for that moment. It ships inside the package, so it is
already on disk once charcheck is installed.

## Install

Name the skill and the runtimes, and take the defaults. This is the form that completes
unattended, which is how an agent will be running it:

```bash
npx skills add ./node_modules/charcheck -s '*' -a claude-code -a codex -a universal -y
```

The same flags work against the repository instead of `node_modules`:

```bash
npx skills add shbernal/charcheck -s '*' -a claude-code -a codex -a universal -y
```

Drop the flags for an interactive prompt if you are at a terminal yourself.

Do not reach for `--all` to avoid the prompt. It installs into every runtime the CLI knows
about, around seventy of them, and leaves an `agent/` directory at your repository root for
runtimes nobody there uses. Name the ones you have.

## Keep it current

The installed copy is a _copy_, so **a version bump does not update it**. Re-run the install
command, or this one, in the same commit as the bump:

```bash
npx skills update charcheck-upstream
```

## What it does

Most of the skill is triage rather than filing. A reproduction here is four lines of config
and a string, so the cheap thing to do is exactly the thing that fills a tracker with
non-bugs. The skill walks through three questions first:

1. Did the rule open the file?
2. Can its scope see that region?
3. Is it already in [Limitations](limitations.md)?

What survives those gets filed with a reproduction that synthesizes its own input. The
flagged text is the user's own prose, and a zero width character does not survive a
clipboard anyway.

## `--report-issue`

`charcheck --report-issue` writes most of the report, with or without the skill. It
includes the one part a pasted config cannot show: every rule as it resolved, and how many
files each one matched.

Directory names in the globs are replaced before they are printed, so it runs unattended
with nothing of your tree in the output. See [Command line](cli.md#--report-issue).

You do not need any of this to report something. The
[issue tracker](https://github.com/shbernal/charcheck/issues) is open.
