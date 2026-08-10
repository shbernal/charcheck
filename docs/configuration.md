# Configuration

charcheck searches upward from the working directory for the first of
`charcheck.config.ts`, `.mts`, `.js`, `.mjs`, `.json`, then a `charcheck` key in
`package.json`. `--config <path>` skips the search.

Globs resolve against **the config file's own directory**, never the working directory, so
running from a subdirectory gives identical results.

For types and editor completion:

```ts
// charcheck.config.ts
import { defineConfig } from 'charcheck/config';

export default defineConfig({
  rules: [{ id: 'no-em-dash', chars: ['\u2014'], include: ['**/*.md'] }],
});
```

## Rule fields

| Field      | Type                             | Meaning                                                                                     |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`       | `string`                         | Required, unique. Appears in output and in suppression comments.                            |
| `chars`    | `string[]`                       | Literal strings to ban. Escaped and matched longest first.                                  |
| `pattern`  | `string`                         | A regular expression source, compiled with `gu`. Use instead of `chars`, never both.        |
| `include`  | `string[]`                       | Required. Globs, or `<commit-msg>` for the commit message.                                  |
| `exclude`  | `string[]`                       | Globs subtracted from `include`.                                                            |
| `scope`    | `'raw' \| 'strings' \| 'markup'` | Default `raw`. See [Scopes](scopes.md).                                                     |
| `severity` | `'error' \| 'warn'`              | Default `error`. Only errors fail a run.                                                    |
| `message`  | `string`                         | Replaces the default, which names the code point.                                           |
| `fix`      | `string \| (ctx) => string`      | A replacement, or a function of the surrounding text. Absent means the rule is not fixable. |

## Top-level fields

`rules`, `ignore` (globs added to every rule's `exclude`), and `markup`.

`node_modules` and `.git` are always ignored. Dotted directories are only scanned when a
pattern names them, so a rule meant to cover `.github/` needs a glob that says so.

## Fixes

`fix` is per rule and opt in, because whether a replacement is safe depends entirely on the
surface. A dash in prose can become a colon; the same dash in a URL cannot.

A fix may be a function of its context, which is the enclosing string literal for `strings`
and `markup`, and the enclosing line for `raw`:

```js
import { strategies } from 'charcheck/config';

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

## Suppressions

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
an example and ignored. That is how this page shows the syntax while still being checked.
Anywhere else, keep the literal token out of prose you want scanned.
