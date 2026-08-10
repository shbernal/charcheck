# charcheck

Flag banned characters, em dashes first and invisibles next, in _targeted_ parts of a repo,
driven by one config, reachable from a package script, a pre-commit hook, and a commit-msg
hook.

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

## Wiring it in

### A package script, the primary path

```json
{
  "scripts": {
    "lint:chars": "charcheck",
    "check": "pnpm run typecheck && pnpm run lint && pnpm run lint:chars && pnpm test"
  }
}
```

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

### Continuous integration

```yaml
- run: pnpm exec charcheck --format sarif > charcheck.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: charcheck.sarif
```

### commitlint

Both can run in `commit-msg` and they do not conflict. charcheck checks characters,
commitlint checks structure.

## Scopes

A rule's `scope` decides which part of a file it may match inside. Choosing the wrong one
fails silently, because a scan that reads nothing looks exactly like a scan that passed.

| Scope           | Reads                                                                                      | Skips                                                               | Applies to                                                   | Needs               |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| `raw` (default) | The whole file                                                                             | Nothing                                                             | Any file                                                     | Nothing             |
| `strings`       | String and template literals                                                               | Comments, identifiers, all other code                               | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | `typescript`        |
| `markup`        | Template text, interpolated literals, allowlisted attribute values, and both script blocks | HTML comments, `<style>`, custom blocks, non-allowlisted attributes | `.vue`                                                       | `@vue/compiler-sfc` |

Both parsers are **optional peer dependencies**, imported only when a rule actually uses
the scope that needs them. A repo using only `raw` installs nothing extra. When one is
missing, the error names the package rather than producing a module-not-found trace.

A rule whose globs can only ever match files its scope cannot read is rejected when the
config loads, since that is the mistake that otherwise looks like a working tool finding
nothing.

### What `markup` counts as rendered text

Static text nodes, interpolation expressions (parsed as TypeScript, so only literals can
match), the values of allowlisted attributes, bound attribute expressions for those same
attributes, and the contents of `<script>` and `<script setup>`.

The attribute allowlist defaults to `title`, `alt`, `placeholder`, `label`, `aria-label`,
`aria-description` and `aria-placeholder`, plus `content` on a `<meta>` tag. Scanning every
attribute would flag class names, URLs and data attributes. Override it wholesale:

```js
export default {
  markup: { textAttributes: ['title', 'alt', 'heading', 'caption'] },
  rules: [...],
};
```

## Config

charcheck searches upward from the working directory for the first of
`charcheck.config.ts`, `.mts`, `.js`, `.mjs`, `.json`, then a `charcheck` key in
`package.json`. `--config <path>` skips the search.

Globs resolve against **the config file's own directory**, never the working directory, so
running from a subdirectory gives identical results.

For types and editor completion:

```ts
// charcheck.config.ts
import { defineConfig, strategies } from '@shbernal/charcheck/config';

export default defineConfig({
  rules: [{ id: 'no-em-dash', chars: ['\u2014'], include: ['**/*.md'] }],
});
```

### Rule fields

| Field      | Type                             | Meaning                                                                                     |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`       | `string`                         | Required, unique. Appears in output and in suppression comments.                            |
| `chars`    | `string[]`                       | Literal strings to ban. Escaped and matched longest first.                                  |
| `pattern`  | `string`                         | A regular expression source, compiled with `gu`. Use instead of `chars`, never both.        |
| `include`  | `string[]`                       | Required. Globs, or `<commit-msg>` for the commit message.                                  |
| `exclude`  | `string[]`                       | Globs subtracted from `include`.                                                            |
| `scope`    | `'raw' \| 'strings' \| 'markup'` | Default `raw`.                                                                              |
| `severity` | `'error' \| 'warn'`              | Default `error`. Only errors fail a run.                                                    |
| `message`  | `string`                         | Replaces the default, which names the code point.                                           |
| `fix`      | `string \| (ctx) => string`      | A replacement, or a function of the surrounding text. Absent means the rule is not fixable. |

Top-level: `rules`, `ignore` (globs added to every rule's `exclude`), and `markup`.
`node_modules` and `.git` are always ignored. Dotted directories are only scanned when a
pattern names them.

### Fixes

`fix` is per rule and opt in, because whether a replacement is safe depends entirely on the
surface. A dash in prose can become a colon; the same dash in a URL cannot.

A fix may be a function of its context, which is the enclosing string literal for `strings`
and `markup`, and the enclosing line for `raw`:

```js
import { strategies } from '@shbernal/charcheck/config';

{
  id: 'clause-separator',
  pattern: '\\s*[\\u2014\\u2015]\\s*',
  fix: strategies.clauseSeparator,
  include: ['docs/**/*.md'],
}
```

`clauseSeparator` replaces the dash and the spaces around it with a colon, or a comma when
the surrounding text already has a colon or holds several dashes. It is a guess about
prose. Read the diff.

`--fix` preserves line endings and a byte order mark: only the matched spans change.

### Suppressions

Any of these anywhere in a line, in whatever comment syntax the file uses:

```
charcheck-disable-line [ruleId...]
charcheck-disable-next-line [ruleId...]
charcheck-disable-file [ruleId...]
```

With no rule ids, every rule is suppressed. This works inside `//`, `#`, `<!-- -->` and
YAML comments without charcheck knowing which language it is reading.

That last property has a consequence worth knowing: charcheck cannot tell a marker in a
comment from the same words in ordinary text, so **writing about the syntax activates it**.
A page documenting the file-level marker would suppress itself, silently, and look like a
clean file forever.

The one exception is a fenced code block in a Markdown file, where a marker is treated as
an example and ignored. That is how this README shows the syntax while still being checked.
Anywhere else, keep the literal token out of prose you want scanned.

## Command line

```
charcheck [paths...]

  --config <path>       Use this config instead of searching upward.
  --fix                 Rewrite fixable findings, then report what is left.
  --staged              Check the staged content of staged files.
  --commit-msg <file>   Check a commit message.
  --format <fmt>        pretty (default), json, or sarif.
  --max-warnings <n>    Exit non-zero when warnings exceed n.
  --quiet               Report errors only.
  --no-color            Disable colour.
  --version, --help
```

Positional paths are **intersected** with each rule's `include`, never substituted for it,
so naming a path that no rule targets scans nothing rather than everything.

| Exit code | Meaning                                      |
| --------- | -------------------------------------------- |
| `0`       | Clean                                        |
| `1`       | Findings, or warnings above `--max-warnings` |
| `2`       | A usage or config error                      |

`2` is kept distinct so a broken config in CI is never mistaken for a real violation.

`json` and `sarif` go to stdout with diagnostics on stderr, so piping to a parser needs no
filtering. The JSON report carries a `schemaVersion`.

### `--staged`

Reads each file's **staged content from the index**, not from the working tree. A hook that
reports a violation the commit does not contain, or blames you for an edit you deliberately
left unstaged, is a hook you will turn off within a week.

With `--fix` it rewrites the working tree and then stages exactly the files it changed, so
the commit carries the fix. That is a real change to your index, stated here rather than
discovered.

### `--commit-msg`

Git passes the message file as `$1`. Comment lines are ignored, as is everything below the
scissors line, which under `commit.verbose` is the entire diff. Messages git generates for
merges, reverts, fixups and squashes are skipped.

`--fix` is refused here. Rewriting your commit message under you is worse than failing.

## Presets

Optional and outside core. Every preset is a function taking the targeting, because what to
ban is general but where to ban it never is.

```js
import { noAiPunctuation, invisibles } from '@shbernal/charcheck/presets';

export default {
  rules: [
    ...noAiPunctuation({ include: ['docs/**/*.md'] }),
    ...invisibles({ include: ['src/**/*.ts'], scope: 'strings', idPrefix: 'code' }),
  ],
};
```

`noAiPunctuation` covers fancy dashes, smart quotes, the ellipsis character and exotic
spaces. `invisibles` covers zero-width characters and bidirectional controls.

**Core ships no vocabulary opinions and never will.** There is no "delve" list, no
"leverage" list. This tool is about characters.

## Programmatic API

The library is a real product surface, not a side effect of the CLI. It touches no process
state, writes nothing, and never exits.

```ts
import { scan } from '@shbernal/charcheck';

const findings = await scan({
  root: process.cwd(),
  rules: [{ id: 'no-em-dash', chars: ['\u2014'], include: ['docs/**/*.md'] }],
});

expect(findings).toEqual([]);
```

`scanText(text, file, rules)` scans a string with no filesystem involved at all. `root` is
required rather than defaulting, so the library never depends on a working directory.

Positions are 1-based and counted in UTF-16 code units, matching ESLint and the language
server protocol, so a column agrees with where an editor puts the cursor.

## Limitations

Stated here rather than discovered later:

- `markup` covers `.vue` only. Svelte and plain HTML are not reachable yet. Both are
  additive behind the same interface.
- `v-html` content is not reachable and is not attempted.
- `<style>` blocks are never read, so text in a CSS `content` property is not checked.
- Vue custom blocks such as `<i18n>` are skipped, though `<i18n>` does hold rendered text
  and is the first candidate for a follow-up.
- No Markdown code-fence awareness. A banned character in a fenced example needs an
  `exclude` glob or a suppression comment.
- A banned character inside a regular expression or a test fixture needs the same.
- A file staged as added and then deleted from the working tree is not scanned under
  `--staged`.

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

## License

MIT
