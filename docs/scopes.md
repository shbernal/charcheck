# Scopes

A rule's `scope` decides which part of a file it may match inside. Choosing the wrong one
fails silently, because a scan that reads nothing looks exactly like a scan that passed.

| Scope           | Reads                                                                                      | Skips                                                                             | Applies to                                                   | Needs                              |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `raw` (default) | The whole file                                                                             | Nothing                                                                           | Any file                                                     | Nothing                            |
| `strings`       | String and template literals                                                               | Comments, identifiers, all other code                                             | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | `typescript`                       |
| `markup`        | Template text, interpolated literals, allowlisted attribute values, and both script blocks | HTML comments, `<style>`, custom blocks, non-allowlisted attributes               | `.vue`                                                       | `@vue/compiler-sfc`, `typescript`* |
| `markdown`      | Prose: paragraphs, headings, list items, quotes, link text, titles, alt text, frontmatter  | Fenced and indented code, inline code spans, link targets, autolinks, HTML blocks | `.md`, `.markdown`                                           | `micromark`                        |
| `html`          | Element text, allowlisted attribute values, and the literals in a script                   | Comments, `<style>`, `<code>`, `<pre>`, non-allowlisted attributes, JSON scripts  | `.html`, `.htm`                                              | `parse5`, `typescript`\*           |

\* `markup` and `html` read script blocks and interpolation expressions the way `strings`
does, so they load `typescript` too. A file with no script never reaches it.

## One rule, one scope

A rule carries a single scope, so a rule cannot ban a character across a docs tree and a
source tree at once. Write one rule per surface:

```js
rules: [
  { id: 'no-em-dash-prose', chars: ['\u2014'], scope: 'markdown', include: ['docs/**/*.md'] },
  { id: 'no-em-dash-code', chars: ['\u2014'], scope: 'strings', include: ['src/**/*.ts'] },
];
```

An include pattern naming an extension its scope cannot read is rejected when the config
loads, and it is rejected even when the same pattern also names one the scope can. So
`scope: 'markdown'` with `src/**/*.{ts,md}` is an error, not a rule that happens to cover
the Markdown half.

That is stricter than it may look worth being, and the reason is what the alternative does:
the extractors return nothing for a file they do not recognize, and nothing is
indistinguishable from a clean file. The `.ts` files would be listed, read, and reported as
passing, with no warning and a zero exit. A rule that has quietly stopped checking half its
target looks exactly like a rule finding nothing wrong, which is the failure this whole
page is about.

A pattern with no literal extension, such as `docs/**`, is not decidable at config time and
is left alone. It may still match a file the scope cannot read, and that file is still
scanned as empty, so a scope with a restricted extension list is worth pairing with a
pattern that names one.

## Parsers are optional peer dependencies

Every one is imported only when a rule actually uses the scope that needs it. A repo using
only `raw` installs nothing extra. When one is missing, the error names the package rather
than producing a module-not-found trace.

The `typescript` peer is the wide `>=5`, and TypeScript 5, 6 and 7 are all supported. They
are not read the same way, and the difference is worth knowing about because one of them
carries a restriction.

TypeScript 5 and 6 are read through the syntax tree: `createSourceFile`, then a walk
collecting literal nodes. TypeScript 7 is the native compiler and ships no in-process
parser, only a token scanner under `typescript/unstable/ast`, so on that version the
literals are read from the token stream instead. Which reader is used is decided by testing
the installed package for the API, never by its version number, so a later major that keeps
one of them keeps working with no release here.

The two readers are held to agreeing: the test suite installs both majors and requires
identical results from them over a corpus of pathological sources and every file in this
repository. The one place they cannot agree is JSX, described below.

A `typescript` that offers neither API throws `UnsupportedPeerDependencyError`, naming the
installed version, and only the rules that actually need a parser are affected. When that
version is inside the range charcheck claims to support, the message says so and links the
issue form: a major that moved the API again is charcheck's to fix, not an install to
downgrade.

### JSX on TypeScript 7

`.tsx` and `.jsx` are refused on TypeScript 7, with an error naming the file. They are read
normally on 5 and 6.

A scanner has no way to know it is inside a JSX element, and that is not a detail: read as
ordinary code, the apostrophe in `<p>don't stop</p>` opens a string literal that runs to the
next quote in the file. The result would be findings in text nobody wrote and silence over
text somebody did. Refusing the file says so out loud. Keeping a TypeScript 5 or 6 for
charcheck to parse with, or excluding those files from the rule, are the two ways round it.

## `strings`

String literals and template literals, and nothing else. Comments, identifiers, JSX
attribute names and every other part of the syntax tree are invisible to it.

This is the scope for source files whose text reaches a user. The point of excluding
comments is that a dash in a comment is a note to another developer, while a dash in a
literal may well be rendered on a page.

## `markup`

What it counts as rendered text: static text nodes, interpolation expressions (parsed as
TypeScript, so only literals can match), the values of allowlisted attributes, bound
attribute expressions for those same attributes, and the contents of `<script>` and
`<script setup>`.

The attribute allowlist defaults to `title`, `alt`, `placeholder`, `label`, `aria-label`,
`aria-description` and `aria-placeholder`, plus `content` on a `<meta>` tag. Scanning every
attribute would flag class names, URLs and data attributes.

Override it wholesale, since a partial merge would make the default impossible to remove:

```js
export default {
  textAttributes: ['title', 'alt', 'heading', 'caption'],
  rules: [...],
};
```

One list covers `markup` and `html` both, because it is a statement about attributes rather
than about the file they are written in. The older spelling, `markup: { textAttributes }`,
still works and means the same thing; setting both is a config error rather than a silent
precedence rule.

`markup` covers `.vue` only today. See [Limitations](limitations.md).

## `markdown`

The prose of a document, which is what `raw` cannot give you: `raw` sees a fenced code block
as text, so every documented shell command and every code example in `docs/**` is a finding
waiting to happen. This is the scope for a docs tree.

What counts as prose: paragraph text, headings of both spellings, list items, block quotes,
table rows, emphasis and strong runs, the words of a link, the alt text of an image, and the
`title` of either. Frontmatter counts too, as one block.

What does not: fenced code, indented code, inline code spans, a link or image target, a
reference definition's label and destination, an autolink, a fence's language tag and its
meta, and an HTML block. Character references and escapes are read as the source wrote them,
so the `&` of `&amp;` is not a finding.

Titles and alt text are included because they reach a reader, as a tooltip or a screen
reader. A link target is excluded because nobody reads it and a URL legitimately contains
punctuation a rule would ban.

Frontmatter is covered whole rather than key by key. A `description:` is rendered on a page
and a `slug:` is not, but telling them apart means knowing the conventions of every site
generator, and the cost of covering a key nobody displays is a finding in text nobody reads.
The block is also split off before parsing, which is not only tidiness: a backtick inside a
frontmatter value would otherwise open a code span and silence the document below it.

A fix sees the enclosing **sentence**, the same unit `raw` gives, because Markdown prose is
hard-wrapped the same way. For the same reason, prose either side of a hard wrap is one
region, so a rule whose pattern spans a space still matches when the author pressed Enter in
the middle of a sentence. Two line endings are a paragraph break and are never joined.

`.mdx` is not `.markdown`. It needs the JSX reader and inherits its TypeScript 7
limitation, so it is a separate surface rather than a spelling of this one. See
[Limitations](limitations.md).

## `html`

The text a page renders: the text of an element, the values of allowlisted attributes, and
the string literals inside a `<script>`. The attribute allowlist is the one `markup` uses,
described above.

What does not count: comments, `<style>`, the values of every attribute off the list, and
the contents of `<code>`, `<pre>`, `<samp>`, `<kbd>` and `<var>`. Those five are excluded for
the reason `markdown` skips a fenced block, which is that a documented command is not prose
and its punctuation is load bearing. A `<script>` whose `type` is not JavaScript, such as
`application/ld+json` or `text/x-template`, is skipped rather than parsed as code.

`<title>`, `<textarea>` and `<template>` are all read. The first two render, and the third
renders as soon as something clones it. A `<noscript>` body is parsed as elements rather than
as raw text, so the prose inside it is reached.

A fix sees the enclosing **sentence**, as under `markdown` and unlike `markup`, because an
HTML paragraph is hard-wrapped the way Markdown prose is. Text either side of a wrap is one
region; text either side of a tag is not, so `before <code>x</code> after` is two regions and
a pattern cannot match across the element between them.

Character references are read as the source wrote them, so the `&` of `&amp;` is one finding
rather than two, matching `markdown`. Positions are always the original file's: the parser
inserts an implied `<html>`, `<head>` and `<body>` where a document omits them, and none of
that reaches disk when a fix is applied.

Templating languages are not understood. A Jinja, Handlebars or ERB expression is text like
any other, so `{{ user_name }}` is scanned as prose. See [Limitations](limitations.md).
