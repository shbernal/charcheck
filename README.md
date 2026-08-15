# charcheck

[![CI](https://github.com/shbernal/charcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/shbernal/charcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/charcheck)](https://www.npmjs.com/package/charcheck)
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
pnpm add -D charcheck
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

| Scope           | Reads                                                  | Applies to             | Needs                             |
| --------------- | ------------------------------------------------------ | ---------------------- | --------------------------------- |
| `raw` (default) | The whole file                                         | Any file               | Nothing                           |
| `strings`       | String and template literals, never comments           | JavaScript, TypeScript | `typescript`                      |
| `markup`        | Template text, allowlisted attributes, script blocks   | `.vue`                 | `@vue/compiler-sfc`, `typescript` |
| `markdown`      | Prose, never fenced or inline code, never link targets | `.md`, `.markdown`     | `micromark`                       |
| `html`          | Page text, allowlisted attributes, script literals     | `.html`, `.htm`        | `parse5`, `typescript`            |

Every parser is an optional peer dependency, imported only when a rule uses the scope that
needs it. A repo using only `raw` installs nothing extra. TypeScript 5, 6 and 7 all work:
5 and 6 are read through the syntax tree, and 7, which ships no in-process parser, through
its token scanner. The one thing that costs is JSX, which a scanner cannot read and which is
therefore refused on 7. Details are in [Scopes](docs/scopes.md).

## Hit a bug? There is a skill for that

Most configs here are written by an agent, and an agent that hits a charcheck defect does
not see an error. It sees a pass. Nothing throws, nothing is logged, and the natural next
move is to add an `exclude` glob and get on with the task, which silences the bug and the
real findings underneath it at the same time. The defect is invisible unless something
teaches it to look.

`charcheck-upstream` is a skill for exactly that moment. It ships inside the package, so it
is already on disk:

```bash
# Name the skill and the runtimes, and take the defaults: this is the form that
# completes unattended, which is how an agent will be running it.
npx skills add ./node_modules/charcheck -s '*' -a claude-code -a codex -a universal -y

npx skills add shbernal/charcheck   # same flags, from the repo instead of node_modules
```

Drop the flags for an interactive prompt if you are at a terminal yourself. Do not reach for
`--all` to avoid the prompt: it installs into every runtime the CLI knows about, around
seventy of them, and leaves an `agent/` directory at your repository root for runtimes
nobody there uses. Name the ones you have. And the installed copy is a _copy_, so **a
version bump does not update it**: re-run that command, or `npx skills update
charcheck-upstream`, in the same commit as the bump.

Most of the skill is triage rather than filing, because a reproduction here is four lines of
config and a string, so the cheap thing to do is exactly the thing that fills a tracker with
non-bugs. Did the rule open the file, can its scope see that region, is it already in
[Limitations](docs/limitations.md). What survives those is ours, and it gets filed with a
reproduction that synthesizes its own input, since the flagged text is the user's own prose
and a zero width character does not survive a clipboard anyway.

Either way, `charcheck --report-issue` writes most of the report for you, including the one
part a pasted config cannot show: every rule as it resolved, and how many files each one
actually matched. Directory names in the globs are replaced before they are printed, so it
runs unattended with nothing of your tree in the output. See
[Command line](docs/cli.md#--report-issue).

You do not need any of this to report something:
<https://github.com/shbernal/charcheck/issues> is open.

## Documentation

| Page                                       | Read it when                                                          |
| ------------------------------------------ | --------------------------------------------------------------------- |
| [Getting started](docs/getting-started.md) | Wiring into scripts, hook managers, or CI                             |
| [Scopes](docs/scopes.md)                   | Deciding what part of a file a rule should read                       |
| [Configuration](docs/configuration.md)     | Writing rules, fixes, or suppression comments                         |
| [Command line](docs/cli.md)                | Looking up a flag or an exit code                                     |
| [Baseline](docs/baseline.md)               | Turning charcheck on in a repository that is not at zero              |
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
