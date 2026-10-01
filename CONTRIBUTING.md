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

Coverage is not in that gate. `pnpm run test:coverage` runs the suite under v8 coverage and
fails below the thresholds in `vitest.config.ts`, and CI runs it once, on Linux, after the
gate. The thresholds are a ratchet set just under the measured numbers: raise them when a
change raises coverage, and never lower them to make a change pass.

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
- **The CLI has no subcommands, and a flag never takes an optional argument.** A path written
  after `--baseline` cannot be told apart from a path to scan, so the baseline's path lives
  in the config and the flag is a boolean. Adding the first subcommand is a bigger decision
  than whatever feature is asking for it, and `parseArgs` cannot express an optional value.
- **The suppression marker is `charcheck-disable-*` and is not configurable.** Making it a
  config key would coincidentally couple text on disk to a config value: change the key and
  every marker already written stops suppressing, silently. It would also have to reach
  `parseSuppressions` through `ExtractorOptions`, which widens the frozen surface and costs a
  minor. The case that asked for it was a repo with an existing marker of its own, and the
  answer to that is a `sed` over the tree, once and reviewable in the diff, or a baseline
  recording the occurrences so they can be migrated at leisure.
- **`--fix --staged` will not fix a file that differs from the index.** Not for the fix's
  sake, which the offset check already covers, but for the `git add` after it: staging takes
  a whole file, so fixing one line of a half-staged file commits every other unstaged change
  in it. Per file, so the rest of the commit is still fixed, and there is no flag to override
  it: the honest answer to a dirty file is to stage or stash it.
- **The bottom of the `typescript` peer range is tested, not raised.** The range is `>=5`
  and the suite runs three compilers: 6 under the plain name, 5 under the
  `typescript-floor` alias and 7 under `typescript-next`, and holds every syntax tree and
  scanner reading to agree across them. The parser reader picks its API by capability, so
  5 and 6 share one code path, and that is exactly why a break at 5 would go unnoticed
  without its own compiler in the suite. Dependabot holds each alias at its major. Raising
  the floor instead would be a break in the peer range, worth a minor when there is a reason
  beyond the cost of one devDependency.
- **`JsxUnsupportedError` stays exported.** It looks internal, since `scan` catches it and
  no CLI code names it, but `scan-files.ts` hands the instance to `ScanOptions.onSkipped`.
  An API consumer therefore receives one and can legitimately branch on it with
  `instanceof`, which `tests/skipped-files.test.ts` asserts. Unexporting it would take an
  error out of a caller's hands while still delivering it to them.

## Adding a scope

The most likely contribution, and by the decision above the only way a surface arrives. A new
surface is a new file in `src/scope/` exporting an extractor, one entry in the registry in
`src/scope/index.ts`, an optional peer dependency declared in `package.json` and imported
lazily (never at module top level), fixtures under `tests/fixtures/`, and a row in the table
in `docs/scopes.md`.

The registry entry is where a scope is defined: its extractor, the extensions it can read,
and the peers it imports. Every field is required, so a scope cannot arrive half declared.
`extensions: null` means unrestricted and is `raw`'s alone; a parser-backed scope that
claimed it would be scanned against files it cannot read, reporting them clean, and would
turn off both the config error and the run warning written to catch exactly that.

A scope that reads TS/JS source is a smaller job than that, because
`src/scope/typescript-peer.ts` already holds everything the existing two share: which
extensions are script files, which language a file is, which of TypeScript's two APIs is
installed, the source file for the parser reader, and the scanner reader with the JSX
refusal inside it. What is left to write is the walk that collects the ranges the new scope
cares about, and the extractor that turns them into chunks. Put anything a second script
scope would need there rather than beside the one that needed it first, since that is what
stops one question growing two answers.

Svelte is the openly wanted one, now that `html` has landed. See
[Limitations](docs/limitations.md).
