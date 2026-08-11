# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below 1.0.0, a minor release may make a breaking change, and says so
against every entry that does. A patch release does not.

## [Unreleased]

### Fixed

- `--quiet` no longer removes warnings from the count as well as from the list. It narrows
  what a report enumerates; the summary line, `summary` in the JSON report, and
  `--max-warnings` all go on seeing every warning. The three used to disagree, so
  `--quiet --max-warnings n` could exit 1 while printing `No banned characters found.` and
  emit a JSON report saying the tree was clean, which is the one failure nobody can act on.
  That combination is what makes the flag usable as a ratchet over an existing backlog, so
  neither half of it was usable before.

  `toJsonReport`, `formatJson` and `formatSarif` take an optional second argument carrying
  the flag; none of them is exported from the package root, and every existing call is
  unchanged in meaning.

- Crossing `--max-warnings` is now reported on stderr, naming the threshold and the distance
  past it. Nothing else in the report explained that exit code, and under `--format json`
  nothing else may be written to stdout.

## [0.2.0]

### Added

- An `html` scope, reading the text a page renders: element text, the values of allowlisted
  attributes, and the string literals inside a `<script>`. Skips comments, `<style>`, the
  attributes off the list, and the contents of `<code>`, `<pre>`, `<samp>`, `<kbd>` and
  `<var>`, for the reason `markdown` skips a fenced block. A `<script>` whose `type` is not
  JavaScript, such as `application/ld+json`, is skipped rather than read as code, while
  `<title>`, `<textarea>`, `<template>` and `<noscript>` are all read. Needs the new optional
  peer `parse5`, imported only when a rule asks for the scope, so nothing changes for a repo
  that does not. `.html` and `.htm` only.

  Not a breaking change. `Scope` gained a member, which no existing config or typed consumer
  can notice, and no other exported shape moved.

  A fix in this scope receives the enclosing sentence, as under `markdown`, because an HTML
  paragraph is hard-wrapped the same way. Text either side of a wrap is one region; text
  either side of a tag is not, so a pattern cannot match across an element.

- A top-level `textAttributes` config key, which is the allowlist `markup: { textAttributes }`
  already held. It now covers `html` as well, so it is named for the attributes rather than
  for one scope. The old spelling still works and means the same thing. Setting both is a
  config error, since they are one setting and picking a winner would discard the other
  silently.

- A `markdown` scope, reading the prose of a document and not its code. `raw` sees a fenced
  block as text, which made `docs/**` the glob every consumer reaches for first and the one
  most likely to report a documented shell command as a finding. Covers paragraphs, headings,
  list items, quotes, table rows, link text, link and image titles, alt text, and frontmatter
  as one block; skips fenced and indented code, inline spans, link and reference targets,
  autolinks, a fence's language tag and meta, and HTML blocks. Needs the new optional peer
  `micromark`, imported only when a rule asks for the scope, so nothing changes for a repo
  that does not. `.md` and `.markdown` only: `.mdx` needs the JSX reader and inherits its
  TypeScript 7 limitation, so it stays a separate surface.

  Not a breaking change. `Scope` gained a member, which no existing config or typed consumer
  can notice, and no other exported shape moved.

  A fix in this scope receives the enclosing sentence, as it does under `raw`, since Markdown
  prose is hard-wrapped the same way. Prose either side of a hard wrap is one region for the
  same reason, so a pattern spanning a space still matches when the author pressed Enter mid
  sentence.

### Changed

- **A config that names an extension its scope cannot read is now rejected, where before it
  loaded and silently checked nothing.** The check already refused a rule whose patterns
  could _only_ match unreadable files; it now refuses a pattern that reaches past what the
  scope reads even when the same pattern also reaches something readable, so
  `scope: 'markdown'` with `src/**/*.{ts,md}` is an error rather than a rule covering the
  Markdown half. The error names the pattern and the offending extensions.

  This can reject a config that loaded under 0.1.0, which is why it is here rather than
  under Fixed, and it is worth the noise: an extractor returns nothing for a file it does not
  recognize, and nothing is indistinguishable from a clean file. Such a file was listed,
  read, reported as passing and exited zero, so a rule that had quietly stopped checking half
  its target looked exactly like a rule finding nothing wrong. That is this tool's
  characteristic failure and the one thing it must not do.

  The fix in a config is to split the rule and give each surface the scope that reads it,
  which `docs/scopes.md` now shows. Patterns with no literal extension, such as `docs/**`,
  are undecidable and are still accepted unchanged.

  No exported shape moved, so this is not a type-level break.

- `clauseSeparator` now writes a pair of parentheses where a pair of dashes bracketed an
  aside, instead of a comma for each. A comma does not bracket, so an aside carrying its own
  commas came out as a flat list and the sentence lost its verb. Over a 126-finding run on a
  real docs tree this was the commonest bad fix by some way. Two dashes with a sentence
  ending between them are two introductions rather than a pair, which a `strings` or
  `markup` container can hold, and three or more dashes is not a pair anything can identify;
  both still fall back to commas.
- `clauseSeparator` now puts back a line break that sat in the whitespace it matched, rather
  than swallowing it. In hard-wrapped prose the fix used to join the two lines and leave the
  paragraph past its wrap column, which review misses because the diff shows the replacement
  as correct and the damage is to a line nobody is looking at. The indent of the line the
  break lands on is kept. The paragraph is not re-flowed, but no line grows by more than the
  punctuation.

### Fixed

- `clauseSeparator` no longer counts a colon that is not sentence punctuation when deciding
  between a colon and a comma. Colons inside an inline code span, a Markdown link or image
  target, a bare URL, and a braced block are ignored, so a line holding a link no longer
  turns a dash that was introducing a clause into a comma splice, and a dash in a template
  literal holding a stylesheet is no longer barred from becoming a colon by `display: block`.

## [0.1.0]

### Added

- The `strings` and `markup` scopes now work on TypeScript 7. That release ships no
  in-process parser, so on it the literals are read from the token scanner under
  `typescript/unstable/ast` rather than from a syntax tree. Which reader is used is decided
  by testing the installed package for the API, not by its version, so a later major that
  keeps either one needs no release here. TypeScript 5 and 6 are read exactly as before.
  The suite installs both majors and requires the two readers to return identical ranges
  over a corpus of pathological sources and every file in this repository.
- A rule whose globs match no file now warns on stderr, naming the rule and its patterns.
  That rule was previously indistinguishable from a rule that passed, which is the one
  failure the report cannot show on its own. The commonest cause is a dotted directory:
  `site/**/*.vue` never reaches `site/.vitepress/theme/Card.vue`. The warning is not raised
  under `--staged` for a rule that merely had nothing staged, since it describes the globs
  rather than the commit.
- `JsxUnsupportedError`, exported from the package root. `.tsx` and `.jsx` cannot be read by
  a scanner, which has no way to know it is inside a JSX element, so on TypeScript 7 those
  files are refused with an error naming the file rather than mis-read. They are unaffected
  on TypeScript 5 and 6. See [docs/scopes.md](docs/scopes.md).
- `ScanOptions.onSkipped`, called with a file a rule targets that no scope could read, and
  the error that refused it. The scan continues over every other file. The CLI names the
  file on stderr and exits 2, because a file that was not looked at has not passed.

### Changed

- **Breaking.** A `raw` rule's fix now receives the enclosing **sentence** as
  `FixContext.container`, where it used to receive the enclosing line. Prose in a repository
  is hard-wrapped, so the two halves of an aside routinely sit on different lines, and a fix
  seeing one half of a dash pair turned both into colons. Measured over one real site, the
  line as the unit got 36% of `clauseSeparator`'s replacements wrong. The paragraph is not
  the unit either: consecutive list items are one paragraph, and a dash in each is not a
  pair. `Chunk.container` is now `'self' | 'sentence'`; `'line'` is gone.
- **Breaking.** `FixContext` gained `index`, the offset of `match` inside `container`. A fix
  that searched its container for the match answered for the first occurrence rather than
  the one being replaced, which is wrong whenever a sentence holds two.
- `clauseSeparator` now writes a comma rather than a colon when the dash is followed by a
  conjunction, since a colon in front of one is never grammatical. A dash between `made of`
  and `and what` has to become a comma.
- `UnsupportedPeerDependencyError` from the `strings` scope now means a `typescript` with
  neither a parser nor a scanner, rather than any TypeScript 7. Its stated range widened
  from `>=5 <7` to `>=5`, matching the peer range.

### Fixed

- On TypeScript 7, a `/` after a non-null assertion was read as opening a regular
  expression rather than dividing. `const n = a! / 2` therefore consumed the rest of the
  file as a pattern, and every literal after it went unreported: a clean run over unscanned
  text. `!` is both the non-null assertion and logical not, and which one it is, is settled
  by the token before it, so that decision is now left standing rather than made twice.
- On TypeScript 7, the closing brace of a `class`, `interface`, `enum`, `namespace`,
  `module` or `type` body was treated as ending a value rather than a statement, so a
  regular expression opening the next statement was read as a division and the quotes
  inside it opened a literal over real code. The declaration keyword is now tracked as far
  as the `{` it introduces. Those keywords are all legal property names, so `{ type: 1 }` is
  still a value.
- On TypeScript 7, malformed source could yield a different number of empty literals from
  the two readers. Neither reports one now; an empty range cannot hold a character.
- A file no scope could read aborted the entire scan, so a single `.tsx` file on
  TypeScript 7 suppressed the findings from every other file. Because nothing reaches a
  parser until a banned character is found, this fired on whichever commit first put one in
  a component rather than at setup.
- The scopes table said `markup` needs only `@vue/compiler-sfc`. It reads script blocks and
  interpolation expressions the way `strings` does, so it loads `typescript` as well.

## [0.0.2]

### Fixed

- charcheck could not be installed under npm in a project on TypeScript 7. The optional
  `typescript` peer was declared as `>=5 <7`, which npm treats as a hard `ERESOLVE` conflict
  rather than a warning, so the install failed even for projects that only scan raw text and
  never load TypeScript at all. The peer range is now `>=5`, and the versions the `strings`
  scope can genuinely parse with are enforced when that scope loads.
- A `strings` rule on TypeScript 7 failed with a property access on `undefined`. TypeScript 7
  moved the compiler API to `typescript/unstable/ast`, so the import succeeds and every call
  against it does not. It now throws `UnsupportedPeerDependencyError`, naming the installed
  version and the range that works. TypeScript 5 and 6 are unaffected. See
  [docs/limitations.md](docs/limitations.md).

### Added

- `UnsupportedPeerDependencyError`, exported from the package root alongside
  `MissingPeerDependencyError`.

### Changed

- Releases are published by a GitHub Actions workflow through npm trusted publishing, so the
  tarball carries a signed provenance attestation linking it to the commit and the workflow
  that built it. No npm token exists in the repository or in its secrets.

## [0.0.1]

First public release.

### Added

- `scan` and `scanText`, a programmatic API that touches no process state, writes nothing,
  and never exits.
- Three scopes: `raw` (the whole file), `strings` (string and template literals in
  JavaScript and TypeScript, via the optional `typescript` peer), and `markup` (rendered
  text in `.vue` files, via the optional `@vue/compiler-sfc` peer).
- Per-rule `fix`, either a replacement string or a function of the surrounding context,
  with `strategies.clauseSeparator` shipped for prose.
- `--staged`, which reads staged content from the index rather than the working tree, and
  stages exactly the files `--fix` rewrites.
- `--commit-msg`, which masks comments, the scissors line and generated messages, and
  refuses `--fix`.
- `<commit-msg>` as a virtual include pattern, so a commit message is targeted by an
  ordinary rule instead of a second configuration format.
- Suppression comments: `charcheck-disable-line`, `-next-line` and `-file`, in whatever
  comment syntax the file uses, ignored inside fenced Markdown code blocks.
- Reporters: `pretty`, `json` (carrying a `schemaVersion`) and `sarif`, on stdout with
  diagnostics on stderr.
- Config discovery for `charcheck.config.ts`, `.mts`, `.js`, `.mjs`, `.json` and a
  `charcheck` key in `package.json`, with globs resolved against the config file's own
  directory.
- `noAiPunctuation` and `invisibles` presets, each a function of the targeting.

### Known limitations

`markup` covers `.vue` only, and there is no Markdown code-fence awareness for findings.
The full list is in [docs/limitations.md](docs/limitations.md).

[unreleased]: https://github.com/shbernal/charcheck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/shbernal/charcheck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shbernal/charcheck/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/shbernal/charcheck/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/shbernal/charcheck/releases/tag/v0.0.1
