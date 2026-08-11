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

| Field      | Type                                           | Meaning                                                                                     |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`       | `string`                                       | Required, unique. Appears in output and in suppression comments.                            |
| `chars`    | `string[]`                                     | Literal strings to ban. Escaped and matched longest first.                                  |
| `pattern`  | `string`                                       | A regular expression source, compiled with `gu`. Use instead of `chars`, never both.        |
| `include`  | `string[]`                                     | Required. Globs, or `<commit-msg>` for the commit message. Matching nothing warns.          |
| `exclude`  | `string[]`                                     | Globs subtracted from `include`.                                                            |
| `scope`    | `'raw' \| 'strings' \| 'markup' \| 'markdown'` | Default `raw`. See [Scopes](scopes.md).                                                     |
| `severity` | `'error' \| 'warn'`                            | Default `error`. Only errors fail a run.                                                    |
| `message`  | `string`                                       | Replaces the default, which names the code point.                                           |
| `fix`      | `string \| (ctx) => string`                    | A replacement, or a function of the surrounding text. Absent means the rule is not fixable. |

## Top-level fields

`rules`, `ignore` (globs added to every rule's `exclude`), and `markup`.

`node_modules` and `.git` are always ignored. Dotted directories are only scanned when a
pattern names them, so a rule meant to cover `.github/` needs a glob that says so.

## Fixes

`fix` is per rule and opt in, because whether a replacement is safe depends entirely on the
surface. A dash in prose can become a colon; the same dash in a URL cannot.

A fix may be a function of its context:

```js
import { strategies } from 'charcheck/config';

{
  id: 'clause-separator',
  pattern: '\\s*[\\u2014\\u2015]\\s*',
  fix: strategies.clauseSeparator,
  scope: 'markdown',
  include: ['docs/**/*.md'],
}
```

It receives `{ container, match, index, scope }`. `container` is the enclosing string
literal for `strings` and `markup`, and the enclosing **sentence** for `raw`, `markdown` and
the text of an `html` page.
`index` is
where `match` starts inside it, which matters because a sentence may hold the same text
twice and searching for it would answer for the wrong one.

The sentence rather than the line, because prose in a repository is hard-wrapped and a line
is a typographic accident. The two halves of an aside routinely land on different ones, and
a fix that can see only one half turns both dashes into colons. Consecutive list items are
one paragraph with no blank line between them, so the paragraph is not the unit either.
Sentences end at terminal punctuation, a blank line, a heading, or the start of a list item,
a table row or an HTML element.

### `clauseSeparator`

Replaces the dash and the whitespace around it with punctuation.

A **pair** of dashes within one sentence brackets an aside, and becomes a pair of
parentheses. A comma cannot do what the pair was doing, because a comma does not bracket:
an aside carrying its own commas collapses into a flat list and the sentence loses its
verb. Two dashes with a sentence ending between them are two introductions rather than a
pair, and three or more is no longer a pair anything can identify; both of those fall back
to commas.

A **lone** dash becomes a colon, or a comma in two cases: the dash is followed by a
conjunction (`and`, `but`, `or`, `nor`, `so`, `yet`, `then`, `because`), or the sentence
already contains a colon doing the introducing.

"Already" is read literally: only a colon **before** the dash counts. A colon further along
has introduced nothing yet, and the commonest one is the colon ending a sentence that
introduces a code block, which is dense in exactly the prose these rules target.

Colons that are not sentence punctuation do not count toward that second case either.
Ignored are the ones inside an inline code span, a Markdown link or image target, a bare
URL, and a braced block, which is what a stylesheet, a JSON fragment or a template
interpolation looks like from here. One Markdown link in the line used to be enough to turn
a colon into a comma splice.

Pair it with a pattern that matches the surrounding whitespace, as above. `\s` rather than
`[ \t]`: a line break inside the match is put back rather than swallowed, so a dash at the
end or the start of a wrapped line keeps its break and the paragraph keeps its wrapping.
Restricting the pattern to horizontal space instead leaves a trailing space behind a
line-final dash and eats the indent in front of a line-initial one.

The break is kept, and the punctuation goes in front of it: it closes the clause above
rather than opening the line below. A line starting with a colon is not neutral in Markdown
either, being definition-list syntax in several flavours.

It is a guess about prose. Read the diff.

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
