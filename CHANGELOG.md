# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below 0.1.0, anything may change in any release.

## [Unreleased]

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

[unreleased]: https://github.com/shbernal/charcheck/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/shbernal/charcheck/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/shbernal/charcheck/releases/tag/v0.0.1
