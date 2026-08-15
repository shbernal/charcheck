# Contributing

Bug reports, questions and pull requests are all welcome. This is a small tool with a
narrow purpose, so the fastest way to get a change merged is to keep it inside that purpose.

## Setup

```bash
corepack enable
pnpm install
```

Node 24 or newer, and pnpm through Corepack. The node floor buys native type stripping,
which is what lets a user's `charcheck.config.ts` load with no bundler and no loader.

## The one gate

```bash
pnpm run check
```

That runs typecheck, lint, format, tests, build, and then charcheck over this repo, in that
order. The build sits in the middle because the self-check runs the freshly built binary.
CI runs exactly this on Linux, Windows and macOS. If it passes locally it should pass there.

Individually: `pnpm run typecheck`, `pnpm run lint`, `pnpm run format` (check only, use
`pnpm exec oxfmt` to fix), `pnpm test`, `pnpm run build`, `pnpm run lint:chars`.

Lint is [oxlint](https://oxc.rs/) and formatting is oxfmt. oxfmt covers JavaScript,
TypeScript, Markdown, JSON and YAML, which is every text format in this repo, so the docs
and this file are machine formatted. Do not hand-align a Markdown table or a JSON array;
both will be rewritten. Anything git ignores is skipped, so an ignored path needs no entry
in `.oxfmtrc.json`.

To run this repo's own hooks, which is how the git modes get exercised:

```bash
git config core.hooksPath .githooks
```

A global `core.hooksPath` may already point elsewhere, in which case `.git/hooks` is ignored
and hooks appear not to run at all.

## `node src/cli.ts` does not work

Type stripping does not rewrite a `.js` specifier to the `.ts` file next to it, and every
internal import ends in `.js` as TypeScript requires. Iterate through `pnpm run build` or
through vitest.

## The dogfooding rule, which catches everyone once

charcheck bans characters, em dashes above all, and this repo runs charcheck on itself.
Anything you write here is subject to its own rules, including the README, the docs, and
test names. Two consequences:

- Test fixtures deliberately contain banned characters. They are excluded from the
  self-check. Keep them under `tests/fixtures/` so the exclusion keeps working.
- When a banned character must appear in real source (a rule definition, a doc example),
  name it through `src/chars.ts`, which builds each one from its code point, or use a
  suppression comment, so the file can still be read by the tool it configures. Do not paste
  the character itself.
- `skills/` ships inside the package, so it is prose this project publishes and it is under
  the same rules as the docs tree. It is also the file most likely to break the next rule,
  since a skill about suppression has to name the markers.

The same rule reaches further than the banned characters. `looksBinary` treats a file holding
a null byte as binary and skips it, so a literal one typed into a source file takes that whole
file out of this project's own scan, silently, while the run still reports itself clean. Where
such a character is needed, write it as an escape: `src/baseline.ts` needs one as a map key
separator and says so at the site.

A related trap: charcheck cannot tell a suppression marker in a comment from the same words
in prose. Writing the file-level marker into a document suppresses that whole document,
silently. Markers inside fenced Markdown code blocks are ignored for exactly this reason,
which is how the docs show the syntax and still get checked.

## Pull requests

- One concern per pull request.
- Add or update tests. The suite is vitest under `tests/`.
- Update `docs/` when behavior, config, or the CLI changes, and add a line to
  `CHANGELOG.md` under `Unreleased`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## Releasing

Maintainers only. Publishing happens in `.github/workflows/publish.yml` and is triggered by
pushing a tag:

1. Move the `Unreleased` entries in `CHANGELOG.md` under a new version heading, and add the
   two link definitions at the bottom of that file.
2. Set the same version in `package.json`.
3. Commit, then `git tag -a vX.Y.Z -m "vX.Y.Z"` and push both the branch and the tag.

The workflow refuses to continue if the tag disagrees with `package.json`, if that version is
already on the registry, if publishing it would move the registry's `latest` tag backwards,
if `pnpm run check` fails, or if `CHANGELOG.md` has no section for the tag. It then publishes
and opens a GitHub release carrying that section as its notes.

That third one is worth knowing about before it stops you. `npm publish` points `latest` at
whatever it published last, in publication order rather than version order, so re-pushing an
old tag quietly makes a plain `npm install` resolve to an older release. Nothing about such a
run looks wrong. To ship a genuine backport, publish it by hand under its own dist-tag rather
than through this workflow.

There is no npm token in this repository. npm authenticates the workflow through trusted
publishing, which identifies it by its path, so renaming the file stops publishing until the
trusted publisher entry on npm is updated to match.

## Design decisions that are settled

Not closed forever, but reopening one needs a reason beyond preference:

- **A scope is an extractor, not a branch.** Every scope returns the regions of a file its
  rules may match inside, and the scanner has no per-scope code. Adding a surface is a new
  file in `src/scope/` plus one table entry.
- **`Scope` stays a closed union, and every surface ships in core.** A scope is a curated
  judgment about what counts as checkable text, not a parser wrapper: `markup` needed an
  attribute allowlist before it was worth having. A registry of third-party extractors, with
  `scope` widened to `Scope | string`, is therefore rejected, and not only on taste. A
  registered scope would have no row in the extension table, and `scopeSupportsFile` reads a
  missing row as "no restriction", so it would silently opt out of the one config check
  written to catch a rule that can never match a file its scope can read. If a rule ever
  needs to carry its own extractor, that takes the shape `fix` already has, a union with a
  function, rather than a registry. It widens `Rule`, so it costs a minor and waits for a
  real request.
- **Fixes are per rule and may be functions**, because whether a replacement is safe depends
  on the surface. A finding therefore carries its resolved `replacement`.
- **Positions are 1-based UTF-16 code units**, matching ESLint and the language server
  protocol, so a reported column agrees with an editor's cursor.
- **`--staged` reads the index, never the working tree.** A hook that reports a violation
  the commit does not contain is a hook people disable.
- **A commit message is masked, not trimmed.** Ignorable text becomes spaces so the file
  keeps its length and positions still point at the line the author typed.
- **Core ships no vocabulary opinions.** This tool is about characters.
- **`JsxUnsupportedError` stays exported.** It looks internal, since `scan` catches it and
  no CLI code names it, but `scan-files.ts` hands the instance to `ScanOptions.onSkipped`.
  An API consumer therefore receives one and can legitimately branch on it with
  `instanceof`, which `tests/skipped-files.test.ts` asserts. Unexporting it would take an
  error out of a caller's hands while still delivering it to them.

## Adding a scope

The most likely contribution, and by the decision above the only way a surface arrives. A new
surface is a new file in `src/scope/` exporting an extractor, one entry in the scope table, an
optional peer dependency declared in `package.json` and imported lazily (never at module top
level), fixtures under `tests/fixtures/`, and a row in the table in `docs/scopes.md`.

Svelte is the openly wanted one, now that `html` has landed. See
[Limitations](docs/limitations.md).
