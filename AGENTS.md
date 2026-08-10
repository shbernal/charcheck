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
pnpm run check       # typecheck + lint + test, the gate before any commit
pnpm run typecheck
pnpm run lint
pnpm run format      # check only; use `pnpm exec prettier --write .` to fix
pnpm test
pnpm run build
```

Node `>=24` and pnpm via Corepack. The node floor is deliberate: native type stripping is
what lets `.ts` config files and `.ts` sources load without a bundler.

## Dogfooding warning

charcheck bans characters — em dashes above all — and this repo runs charcheck on itself.
Anything you write here is subject to its own rules, including this file, the README, and
test names. Two consequences:

- Test fixtures deliberately contain banned characters. They are excluded from the
  self-check; keep them under `tests/fixtures/` so the exclusion keeps working.
- When a banned character must appear in real source (a rule definition, a doc example),
  use an escape (`'—'`) or a suppression comment rather than the literal, so the file
  can still be read by the tool it configures.

## Layout

- `src/` sources, `dist/` build output, `tests/` vitest suites and fixtures.
- Optional peer dependencies (`typescript`, `@vue/compiler-sfc`) are imported lazily and
  only when a rule uses the scope that needs them. Never import them at module top level.
