# Scopes

A rule's `scope` decides which part of a file it may match inside. Choosing the wrong one
fails silently, because a scan that reads nothing looks exactly like a scan that passed.

| Scope           | Reads                                                                                      | Skips                                                               | Applies to                                                   | Needs                              |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `raw` (default) | The whole file                                                                             | Nothing                                                             | Any file                                                     | Nothing                            |
| `strings`       | String and template literals                                                               | Comments, identifiers, all other code                               | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | `typescript`                       |
| `markup`        | Template text, interpolated literals, allowlisted attribute values, and both script blocks | HTML comments, `<style>`, custom blocks, non-allowlisted attributes | `.vue`                                                       | `@vue/compiler-sfc`, `typescript`* |

\* `markup` reads a component's script blocks and interpolation expressions the way
`strings` does, so it loads `typescript` too. A component with neither never reaches it.

A rule whose globs can only ever match files its scope cannot read is rejected when the
config loads, since that is the mistake that otherwise looks like a working tool finding
nothing.

## Parsers are optional peer dependencies

Both are imported only when a rule actually uses the scope that needs them. A repo using
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
installed version, and only the rules that actually need a parser are affected.

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
  markup: { textAttributes: ['title', 'alt', 'heading', 'caption'] },
  rules: [...],
};
```

`markup` covers `.vue` only today. See [Limitations](limitations.md).
