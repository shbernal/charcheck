# charcheck

Flag banned characters — em dashes first, invisibles next — in targeted parts of a repo,
driven by one config, reachable from a package script, a pre-commit hook, and a commit-msg
hook.

Existing tools are single-surface: ESLint plugins see only the JS AST, prose linters see
only Markdown, and commit messages have nothing at all. charcheck covers all three from one
banned-character list.

Work in progress; documentation lands with the first release.

## License

MIT
