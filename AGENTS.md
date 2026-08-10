# AGENTS.md

## Pre-Release Project Guidance

This project has no GitHub release yet:

- Treat the project as pre-release and free to change.
- Do not preserve backwards compatibility unless Santiago explicitly asks for it.
- Do not defer to the prior architecture when it conflicts with the current goal.
- Existing code, docs, and plans are context, not constraints.
- Prefer the simplest coherent architecture for the current project direction.

Once the project has a GitHub release, compatibility and migration concerns become real
project constraints and must be evaluated before breaking changes.

## Commands

```bash
pnpm install
pnpm run check       # the single gate before any commit
```

`check` runs typecheck, lint, format, tests, build, and then charcheck over this repo. The
build is in the middle because `lint:chars` runs the freshly built binary.

Individually: `pnpm run typecheck`, `pnpm run lint`, `pnpm run format` (check only, use
`pnpm exec prettier --write .` to fix), `pnpm test`, `pnpm run build`, `pnpm run lint:chars`.

Node `>=24` and pnpm via Corepack. The node floor is deliberate: it buys native type
stripping, which is what lets a user's `charcheck.config.ts` load with no bundler and no
loader.

Note that `node src/cli.ts` does **not** work. Type stripping does not rewrite a `.js`
specifier to the `.ts` file next to it, and every internal import ends in `.js` as
TypeScript requires. Iterate through `pnpm run build` or vitest.

To run this repo's own hooks (recommended, they are how the git modes get exercised):

```bash
git config core.hooksPath .githooks
```

A global `core.hooksPath` may already point elsewhere, in which case `.git/hooks` is
ignored and hooks appear not to run at all.

## Dogfooding warning

charcheck bans characters, em dashes above all, and this repo runs charcheck on itself.
Anything you write here is subject to its own rules, including this file, the README, and
test names. Two consequences:

- Test fixtures deliberately contain banned characters. They are excluded from the
  self-check; keep them under `tests/fixtures/` so the exclusion keeps working.
- When a banned character must appear in real source (a rule definition, a doc example),
  name it through `src/chars.ts`, which builds each one from its code point, or use a
  suppression comment, so the file can still be read by the tool it configures. Do not
  paste the character itself.

A related trap: charcheck cannot tell a suppression marker in a comment from the same words
in prose. Writing the file-level marker into a document suppresses that whole document,
silently. Markers inside fenced Markdown code blocks are ignored for exactly this reason,
which is how the README documents the syntax and still gets checked.

## Layout

- `src/` sources, `dist/` build output, `tests/` vitest suites and fixtures.
- Optional peer dependencies (`typescript`, `@vue/compiler-sfc`) are imported lazily and
  only when a rule uses the scope that needs them. Never import them at module top level.

## Decisions worth not relitigating

- **A scope is an extractor, not a branch.** Every scope returns the regions of a file its
  rules may match inside, and the scanner has no per-scope code. Adding a surface is a new
  file in `src/scope/` plus one table entry.
- **Fixes are per rule and may be functions**, because whether a replacement is safe
  depends on the surface. A finding therefore carries its resolved `replacement`: a
  contextual fix reads the text around its match, and that context is gone by the time the
  fixer runs.
- **Positions are 1-based UTF-16 code units**, matching ESLint and the language server
  protocol, so a reported column agrees with an editor's cursor.
- **`--staged` reads the index, never the working tree.** A hook that reports a violation
  the commit does not contain is a hook people disable.
- **A commit message is masked, not trimmed.** Ignorable text becomes spaces so the file
  keeps its length and positions still point at the line the author typed.
- **`<commit-msg>` is a virtual include pattern**, which is what lets a message be targeted
  by an ordinary rule instead of a second configuration format.
