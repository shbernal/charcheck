# Limitations

Stated here rather than discovered later.

## Surfaces not reached

- `markup` covers `.vue` only. Svelte and plain HTML are not reachable yet. Both are
  additive behind the same interface.
- There is no plugin API, by decision. A scope is not something a config can register, so
  the set of surfaces is fixed by the release you have installed. A surface that is missing
  is a feature request rather than a configuration problem.
- `v-html` content is not reachable and is not attempted.
- `<style>` blocks are never read, so text in a CSS `content` property is not checked.
- Vue custom blocks such as `<i18n>` are skipped, though `<i18n>` does hold rendered text
  and is the first candidate for a follow-up.
- `markdown` covers `.md` and `.markdown`. `.mdx` is not reachable: it needs the JSX reader
  and would inherit its TypeScript 7 limitation, so it is a separate surface.
- An HTML block inside a Markdown document is skipped by `markdown`, attributes and text
  alike. Text in one does render, so this is a miss rather than a safe answer, and it is the
  cheap direction to be wrong in. A rule needing that text can read the file with `raw`.
- A fence's language tag and its meta are skipped, which includes the `title="..."` that
  some site generators render as a caption above a code block.

## TypeScript 7

TypeScript 5, 6 and 7 are all supported, but 7 ships no in-process parser, so on that
version the `strings` and `markup` scopes read literals from a token scanner instead of a
syntax tree. Two consequences:

- `.tsx` and `.jsx` are refused, with an error naming the file. A scanner cannot be told it
  is inside a JSX element, and the apostrophe in `<p>don't stop</p>` would open a string
  literal running to the next quote in the file. See [Scopes](scopes.md). The refused file
  is named on stderr and the run exits 2: it was not looked at, which is not the same
  answer as finding nothing in it. Every other file is still scanned and reported.
- The scanner reads `typescript/unstable/ast`, which upstream marks unstable. A rename there
  is caught and reported rather than silently matching nothing, but it would still need a
  release here to fix.
- A scanner has no parser context, so where `/` divides and where it opens a pattern is
  decided by the token walk rather than known. The decision is right on everything the
  suite covers, which is the TypeScript compiler's own nine megabytes of source plus a set
  of cases written against each ambiguous position. One position is genuinely undecidable
  from tokens alone and is read the other way: a labelled block, `label: { … }`, is taken
  for an object literal, so a regular expression opening the statement after its `}` is
  read as a division. Nothing else known diverges.

None of this applies on TypeScript 5 or 6, which are read through the syntax tree.

## Things you have to exclude by hand

- A banned character in a fenced Markdown example needs an `exclude` glob or a suppression
  comment **under `raw`**, which reads a document as plain text. The `markdown` scope skips
  fences, so this is a reason to prefer it for a docs tree. (Suppression _markers_ inside
  fences are ignored under either scope, which is a separate mechanism.)
- A banned character inside a regular expression or a test fixture needs the same.

## Git

- A file staged as added and then deleted from the working tree is not scanned under
  `--staged`.

## Not a bug

If charcheck reports success on a file you know contains a banned character, the usual
cause is scope rather than any of the above. A rule with `scope: 'strings'` cannot see a
comment. See [Scopes](scopes.md).

If the rule never opened the file at all, a warning on stderr says so:

```
charcheck: rule "no-em-dash-in-markup" matched no files: site/**/*.vue. Check the
globs; a dotted directory is only entered when a pattern names it.
```

That last clause is the usual cause. `site/**/*.vue` does not reach
`site/.vitepress/theme/Card.vue`, because no pattern names `.vitepress`, and nobody expects
`docs/**` to walk into `.github` either. Name the directory: `site/.vitepress/**/*.vue`.

The warning does not fire under `--staged` for a rule that simply had nothing staged. It
describes the globs, not the commit.
