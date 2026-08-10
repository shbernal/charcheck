# Getting started

## Install

```bash
pnpm add -D charcheck
```

Requires Node 24 or newer. That floor is deliberate: native type stripping is what lets a
`charcheck.config.ts` load with no bundler, no loader, and no extra dependency.

## A package script, the primary path

```json
{
  "scripts": {
    "lint:chars": "charcheck",
    "check": "pnpm run typecheck && pnpm run lint && pnpm run lint:chars && pnpm test"
  }
}
```

Everything else on this page is optional. A tool that only runs in a git hook is a tool
nobody can reproduce locally, so the script comes first and the hooks call the same thing.

## Git hooks

### lefthook

```yaml
# lefthook.yml
pre-commit:
  jobs:
    - name: charcheck
      run: pnpm exec charcheck --staged
commit-msg:
  jobs:
    - name: charcheck
      run: pnpm exec charcheck --commit-msg {1}
```

With `--fix`, add `stage_fixed: true` so the rewritten files reach the commit.

### husky

```sh
# .husky/pre-commit
pnpm exec charcheck --staged
```

```sh
# .husky/commit-msg
pnpm exec charcheck --commit-msg "$1"
```

### No framework at all

A hook manager is not a prerequisite. Two lines in `.git/hooks/pre-commit` work:

```sh
#!/bin/sh
exec pnpm exec charcheck --staged
```

If your hooks do not seem to run, check `git config --get core.hooksPath`. A global setting
points git somewhere other than `.git/hooks`.

### lint-staged

Do not run charcheck through lint-staged. `charcheck --staged` already selects the staged
files and reads their staged content, so doing both means scanning everything twice and
letting the two file lists disagree.

### commitlint

Both can run in `commit-msg` and they do not conflict. charcheck checks characters,
commitlint checks structure.

## Continuous integration

The plain form is `pnpm exec charcheck`, which exits non-zero on findings. To get
annotations on the pull request instead, emit SARIF and upload it:

```yaml
- run: pnpm exec charcheck --format sarif > charcheck.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: charcheck.sarif
```

`continue-on-error` is what lets the upload step run even when charcheck found something,
which is the whole point of producing the report.
