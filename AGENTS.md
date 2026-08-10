# AGENTS.md

## Pre-Release Project Guidance

This project is published but still below 0.1.0:

- Treat the project as pre-release and free to change.
- Do not preserve backwards compatibility unless Santiago explicitly asks for it.
- Do not defer to the prior architecture when it conflicts with the current goal.
- Existing code, docs, and plans are context, not constraints.
- Prefer the simplest coherent architecture for the current project direction.

Once the project reaches 1.0, compatibility and migration concerns become real project
constraints and must be evaluated before breaking changes. Until then, note breaking
changes in `CHANGELOG.md` rather than working around them.

## Read this first

[CONTRIBUTING.md](CONTRIBUTING.md) holds the setup, the single `pnpm run check` gate, the
`node src/cli.ts` trap, the dogfooding rule, and the settled design decisions. It is the
same information a human contributor gets, so it is maintained rather than duplicated here.

The short version:

```bash
pnpm install
pnpm run check       # the single gate before any commit
```

Two traps that cost the most time when hit:

- **`node src/cli.ts` does not work.** Type stripping does not rewrite a `.js` specifier to
  the `.ts` file beside it. Iterate through `pnpm run build` or vitest.
- **This repo runs charcheck on itself.** Do not paste a banned character into any file the
  self-check reads, including this one. Build it from its code point through `src/chars.ts`,
  or write it as an escape inside a fenced code block.

## Layout

- `src/` sources, `dist/` build output, `tests/` vitest suites and fixtures.
- `docs/` is the user-facing reference. Update it when behavior, config, or the CLI changes.
- Optional peer dependencies (`typescript`, `@vue/compiler-sfc`) are imported lazily and
  only when a rule uses the scope that needs them. Never import them at module top level.

## Where documentation goes

- `README.md`: why the tool exists, install, the shortest path to running it. Resist
  growing it back into a manual.
- `docs/`: everything a user might need to look up.
- `CONTRIBUTING.md`: how to build, test, and extend the project.
- `AGENTS.md`: only what an agent needs that a human contributor does not.
