# Limitations

Stated here rather than discovered later.

Every heading on this page is a link target used elsewhere: by the issue forms, and by the
`charcheck-upstream` skill, which walks an agent through deciding whether a miss is a bug
worth filing. Renaming one breaks those links, so reword a heading only when the behaviour
it names has changed too.

## Surfaces not reached

### Svelte has no scope

`markup` covers `.vue` only. Svelte is not reachable yet, and is additive behind the same
interface, so it is the most wanted contribution. Plain HTML has its own scope, `html`.

### A template language inside `html` is read as prose

`html` covers `.html` and `.htm`. A template language on top of it is not understood: a
Jinja, Handlebars or ERB expression is scanned as the prose it looks like, so
`{{ user_name }}` is text a rule can match inside.

### There is no plugin API

By decision. A scope is not something a config can register, so the set of surfaces is
fixed by the release you have installed. A surface that is missing is a feature request
rather than a configuration problem.

### `v-html` content is not reachable

Not attempted, either.

### `<style>` is never read

Not under `markup` and not under `html`, so text in a CSS `content` property is not
checked.

### Vue custom blocks are skipped

Blocks such as `<i18n>`, though `<i18n>` does hold rendered text and is the first candidate
for a follow-up.

### `.mdx` is not reachable

`markdown` covers `.md` and `.markdown`. `.mdx` needs the JSX reader and would inherit its
TypeScript 7 limitation, so it is a separate surface.

### An HTML block inside Markdown is skipped

By `markdown`, attributes and text alike. Text in one does render, so this is a miss rather
than a safe answer, and it is the cheap direction to be wrong in. A rule needing that text
can read the file with `raw`. The `html` scope does not help here: a rule carries one scope,
so `markdown` has no way to hand the block over.

### A fence's language tag and meta are skipped

Which includes the `title="..."` that some site generators render as a caption above a code
block.

## TypeScript 7

TypeScript 5, 6 and 7 are all supported, but 7 ships no in-process parser, so on that
version the `strings` and `markup` scopes read literals from a token scanner instead of a
syntax tree. Three consequences.

### `.tsx` and `.jsx` are refused on TypeScript 7

With an error naming the file. A scanner cannot be told it is inside a JSX element, and the
apostrophe in `<p>don't stop</p>` would open a string literal running to the next quote in
the file. See [Scopes](scopes.md). The refused file is named on stderr and the run exits 2:
it was not looked at, which is not the same answer as finding nothing in it. Every other
file is still scanned and reported.

### The scanner reads an unstable module

`typescript/unstable/ast`, which upstream marks unstable. A rename there is caught and
reported rather than silently matching nothing, but it would still need a release here to
fix.

### A labelled block is read as an object literal

A scanner has no parser context, so where `/` divides and where it opens a pattern is
decided by the token walk rather than known. The decision is right on everything the suite
covers, which is the TypeScript compiler's own nine megabytes of source plus a set of cases
written against each ambiguous position. One position is genuinely undecidable from tokens
alone and is read the other way: a labelled block, `label: { … }`, is taken for an object
literal, so a regular expression opening the statement after its `}` is read as a division.
Nothing else known diverges.

None of this applies on TypeScript 5 or 6, which are read through the syntax tree.

## Things you have to exclude by hand

### A banned character in a fenced Markdown example

Needs an `exclude` glob or a suppression comment **under `raw`**, which reads a document as
plain text. The `markdown` scope skips fences, so this is a reason to prefer it for a docs
tree. (Suppression _markers_ inside fences are ignored under either scope, which is a
separate mechanism.)

### A banned character in a regular expression or a test fixture

Needs the same.

## Git

### A file staged as added and then deleted is not scanned

Under `--staged`, that is.

## Not a bug

If charcheck reports success on a file you know contains a banned character, the cause is
usually one of these two rather than anything above.

### The rule never opened the file

A warning on stderr says so:

```
charcheck: rule "no-em-dash-in-markup" matched no files: site/**/*.vue. Check the
globs; a dotted directory is only entered when a pattern names it.
```

That last clause is the usual cause. `site/**/*.vue` does not reach
`site/.vitepress/theme/Card.vue`, because no pattern names `.vitepress`, and nobody expects
`docs/**` to walk into `.github` either. Name the directory: `site/.vitepress/**/*.vue`.

The warning does not fire under `--staged` for a rule that simply had nothing staged. It
describes the globs, not the commit.

### The scope cannot see that region

A rule with `scope: 'strings'` cannot see a comment, `markdown` skips fenced code and
inline spans, and neither `markup` nor `html` reads `<style>`. The scope is the first thing
to check once you know the file was opened. See [Scopes](scopes.md).

A file the scope cannot read at all is the sharper version of this: it is extracted as empty,
so it reports exactly as a clean one. Where a rule's scope can read none of the files it
matched, a warning on stderr says so. Where it can read only some of them, nothing is said
during the run, and `charcheck --report-issue` prints the count per rule.
