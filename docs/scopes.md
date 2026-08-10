# Scopes

A rule's `scope` decides which part of a file it may match inside. Choosing the wrong one
fails silently, because a scan that reads nothing looks exactly like a scan that passed.

| Scope           | Reads                                                                                      | Skips                                                               | Applies to                                                   | Needs               |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| `raw` (default) | The whole file                                                                             | Nothing                                                             | Any file                                                     | Nothing             |
| `strings`       | String and template literals                                                               | Comments, identifiers, all other code                               | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | `typescript`        |
| `markup`        | Template text, interpolated literals, allowlisted attribute values, and both script blocks | HTML comments, `<style>`, custom blocks, non-allowlisted attributes | `.vue`                                                       | `@vue/compiler-sfc` |

A rule whose globs can only ever match files its scope cannot read is rejected when the
config loads, since that is the mistake that otherwise looks like a working tool finding
nothing.

## Parsers are optional peer dependencies

Both are imported only when a rule actually uses the scope that needs them. A repo using
only `raw` installs nothing extra. When one is missing, the error names the package rather
than producing a module-not-found trace.

The `strings` scope requires TypeScript 5 or 6. TypeScript 7 is the native compiler, and it
no longer ships a JavaScript parser: `createSourceFile` and the AST walk this scope is built
on moved out of the package root, so there is nothing to parse with in-process. The peer
range is capped at `<7` to make that a resolution error at install time rather than a
failure on the first file scanned.

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
