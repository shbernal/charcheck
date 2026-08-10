# Limitations

Stated here rather than discovered later.

## Surfaces not reached

- `markup` covers `.vue` only. Svelte and plain HTML are not reachable yet. Both are
  additive behind the same interface.
- `v-html` content is not reachable and is not attempted.
- `<style>` blocks are never read, so text in a CSS `content` property is not checked.
- Vue custom blocks such as `<i18n>` are skipped, though `<i18n>` does hold rendered text
  and is the first candidate for a follow-up.

## Things you have to exclude by hand

- No Markdown code-fence awareness for findings. A banned character in a fenced example
  needs an `exclude` glob or a suppression comment. (Suppression _markers_ inside fences
  are ignored, which is a separate mechanism.)
- A banned character inside a regular expression or a test fixture needs the same.

## Git

- A file staged as added and then deleted from the working tree is not scanned under
  `--staged`.

## Not a bug

If charcheck reports success on a file you know contains a banned character, the usual
cause is scope rather than any of the above. A rule with `scope: 'strings'` cannot see a
comment, and a rule whose `include` does not name a dotted directory will never open one.
See [Scopes](scopes.md).
