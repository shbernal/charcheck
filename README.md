# charcheck

[![CI](https://github.com/shbernal/charcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/shbernal/charcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@shbernal/charcheck)](https://www.npmjs.com/package/@shbernal/charcheck)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Flag banned characters, em dashes first and invisibles next, in _targeted_ parts of a repo,
driven by one config, reachable from a package script, a pre-commit hook, and a commit-msg
hook.

## Why this exists

Every existing tool sees one surface. ESLint plugins see the JavaScript AST and nothing
else. Prose linters see Markdown and nothing else. Commit messages have nothing at all. So
banning one character across a repo means three tools, three configs, and a gap where the
commit message goes.

charcheck covers all three from one banned-character list, and lets each surface have its
own policy. That is the whole idea:

```js
// charcheck.config.js
const DASHES = ['\u2014', '\u2015']; // em dash, horizontal bar

export default {
  rules: [
    {
      // Prose: the whole file, comments included.
      id: 'no-em-dash-in-prose',
      chars: DASHES,
      fix: '-',
      include: ['README.md', 'docs/**/*.md'],
    },
    {
      // Code: only text that can render. Comments are exempt on purpose.
      id: 'no-em-dash-in-rendered-text',
      chars: DASHES,
      scope: 'strings',
      include: ['src/**/*.ts', 'site/.vitepress/config.ts'],
    },
    {
      // Components: template text and allowlisted attributes. Styles exempt.
      id: 'no-em-dash-on-the-page',
      chars: DASHES,
      scope: 'markup',
      include: ['site/**/*.vue'],
    },
    {
      id: 'no-em-dash-in-commit-msg',
      chars: DASHES,
      include: ['<commit-msg>'],
    },
  ],
};
```

One character list, four surfaces, opposite policies about comments.

## Install

```bash
pnpm add -D @shbernal/charcheck
```

Requires Node 24 or newer. That floor is deliberate: native type stripping is what lets a
`charcheck.config.ts` load with no bundler, no loader, and no extra dependency.

## Use it

Write a `charcheck.config.js` like the one above, then wire it to a script:

```json
{
  "scripts": {
    "lint:chars": "charcheck"
  }
}
```

```bash
pnpm run lint:chars          # scan
pnpm run lint:chars --fix    # rewrite what is fixable, report the rest
```

To check what is actually being committed rather than what is on disk:

```bash
charcheck --staged                  # pre-commit, reads the git index
charcheck --commit-msg "$1"         # commit-msg
```

Those two are the point of the tool, and they work under lefthook, husky, or two lines in
`.git/hooks`. See [Getting started](docs/getting-started.md) for each.

## What a rule can look inside

A rule's `scope` decides which part of a file it may match inside. Getting this wrong fails
silently, because a scan that reads nothing looks exactly like a scan that passed.

| Scope           | Reads                                                | Applies to             | Needs               |
| --------------- | ---------------------------------------------------- | ---------------------- | ------------------- |
| `raw` (default) | The whole file                                       | Any file               | Nothing             |
| `strings`       | String and template literals, never comments         | JavaScript, TypeScript | `typescript`        |
| `markup`        | Template text, allowlisted attributes, script blocks | `.vue`                 | `@vue/compiler-sfc` |

Both parsers are optional peer dependencies, imported only when a rule uses the scope that
needs them. A repo using only `raw` installs nothing extra. Details, including why the
`typescript` peer is capped below 7, are in [Scopes](docs/scopes.md).

## Documentation

| Page                                       | Read it when                                                          |
| ------------------------------------------ | --------------------------------------------------------------------- |
| [Getting started](docs/getting-started.md) | Wiring into scripts, hook managers, or CI                             |
| [Scopes](docs/scopes.md)                   | Deciding what part of a file a rule should read                       |
| [Configuration](docs/configuration.md)     | Writing rules, fixes, or suppression comments                         |
| [Command line](docs/cli.md)                | Looking up a flag or an exit code                                     |
| [Programmatic API](docs/api.md)            | Calling `scan` from a script or a test                                |
| [Presets](docs/presets.md)                 | Reaching for a ready-made character list                              |
| [Limitations](docs/limitations.md)         | Something is not caught and you want to know whether that is expected |

## Prior art

Worth knowing about before choosing this one:

- [eslint-plugin-em-dash-checker](https://www.npmjs.com/package/eslint-plugin-em-dash-checker):
  em dashes in JavaScript string literals, inside ESLint. If your text lives only in code
  and you already run ESLint, that is a smaller dependency than this one.
- [textlint](https://textlint.github.io/) with
  [prh](https://github.com/textlint-rule/textlint-rule-prh): a mature prose linting
  ecosystem, considerably more capable for natural language, scoped to prose files.
- [Vale](https://vale.sh/): the serious prose linter, with real style guides. A separate
  binary and a different kind of tool.
- [slop-lint](https://www.npmjs.com/package/slop-lint): opinions about vocabulary as well
  as characters. charcheck deliberately has none.

charcheck exists for the case none of those cover: one banned-character list applied to
code, prose, components and commit messages at once, with a different policy for each.

**Core ships no vocabulary opinions and never will.** There is no "delve" list, no
"leverage" list. This tool is about characters.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
build, the single check gate, and the dogfooding rule that catches everyone once.

## License

[MIT](LICENSE)
