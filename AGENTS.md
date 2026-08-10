# AGENTS.md

## Project stage

0.1.0 is published, so compatibility is a real constraint now, but a narrow one:

- A change to `Rule`, `Scope`, `FixContext`, `ScanOptions` or an exported error class is a
  break. It needs a minor version and a `CHANGELOG.md` entry that says so out loud. Batch
  such changes into one minor rather than spending a version on each.
- Everything else is still free to change. Below 1.0 a break is allowed, it is only never
  allowed to be silent.
- Do not defer to the prior architecture when it conflicts with the current goal. Existing
  code, docs, and plans are context, not constraints, and the simplest coherent architecture
  for the current direction wins.

Once the project reaches 1.0, migration concerns become real too and must be evaluated
before any break.

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
- Optional peer dependencies (`typescript`, `@vue/compiler-sfc`, `micromark`) are imported
  lazily, only when a rule uses the scope that needs them. Never import one at module top
  level.

## Where documentation goes

- `README.md`: why the tool exists, install, the shortest path to running it. Resist
  growing it back into a manual.
- `docs/`: everything a user might need to look up.
- `CONTRIBUTING.md`: how to build, test, and extend the project.
- `AGENTS.md`: only what an agent needs that a human contributor does not.
