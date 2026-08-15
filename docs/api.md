# Programmatic API

The library is a real product surface, not a side effect of the CLI. It touches no process
state, writes nothing, and never exits.

```ts
import { scan } from 'charcheck';

const findings = await scan({
  root: process.cwd(),
  rules: [{ id: 'no-em-dash', chars: ['\u2014'], include: ['docs/**/*.md'] }],
});

expect(findings).toEqual([]);
```

`root` is required rather than defaulting, so the library never depends on a working
directory.

## `scanText`

`scanText(text, file, rules)` scans a string with no filesystem involved at all. The `file`
argument is a name used for reporting and for deciding which rules apply; nothing is read
from disk.

This is the entry point for testing your own rules, or for checking text that never becomes
a file.

## Positions

Positions are 1-based and counted in UTF-16 code units, matching ESLint and the language
server protocol, so a column agrees with where an editor puts the cursor.

## Findings carry their replacement

A finding carries its resolved `replacement` rather than a reference to the rule's `fix`.
A contextual fix reads the text around its match, and that context is gone by the time a
fixer runs, so resolving it at scan time is what makes a finding self-contained.

## Applying fixes

`applyFixes(text, findings)` returns the rewritten text. It writes nothing, so a caller
decides whether the result reaches disk.

Findings are applied right to left, so an earlier offset stays valid after a later
replacement has changed the length of the text, and two findings whose spans overlap do not
corrupt each other. Line endings are never normalized and a byte order mark is preserved:
only the matched spans are touched, and the file is never re-serialized.

**A finding is only valid against the text it was scanned from**, and nothing in the types
pairs the two. So each fix is checked before it is written: if the text at a finding's offset
is no longer the text it matched, that fix is skipped rather than applied. Pass `onSkipped`
to see why, which is also how to count what was actually written:

```ts
let written = 0;
const output = applyFixes(text, findings, {
  onSkipped: (finding, reason) => {
    // 'stale'   the text there has changed, so the offset means nothing
    // 'overlap' another finding's replacement already covers this span
    console.warn(`skipped ${finding.ruleId}: ${reason}`);
  },
});
```

Without that check, handing over text that has moved on since the scan rewrites whatever now
sits at those offsets. That is a real pairing, not a hypothetical one: it is what
`--fix --staged` does, scanning the git index and writing the working tree.

One call is **one pass**, and one pass is not always the answer. A replacement is arbitrary
text and can hold what another rule bans, and a fix skipped for overlap was never judged
against the text the applied ones left behind. A caller that wants what the rules agree on
scans the result and applies again until nothing changes. That is what `--fix` does, with a
limit on the passes, since two rules can rewrite each other forever. See
[Command line](cli.md).

## Scanning what a config file says to scan

`scan` takes rules directly, which is what a test wants. To run the config a repo already
has, load it and hand the result over, both from `charcheck/config`:

```ts
import { loadConfig, scanWithConfig } from 'charcheck/config';

const loaded = await loadConfig({ from: process.cwd() });
const findings = await scanWithConfig(loaded);
```

`loadConfig` searches upward from `from` and validates what it finds, throwing
`ConfigNotFoundError` or `ConfigError`; `configPath` skips the search. `scanWithConfig`
takes the same `files` and `root` narrowing the CLI's positional paths use.

Globs resolve against the config file's own directory, never `from`, so the result does not
depend on where the process started. `toScanOptions` returns those resolved options without
scanning, for a caller that wants to add its own `onWarning` or `read` first, which is how
the CLI implements `--staged`.

## What else the root exports

| Export                                                                                                         | For                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `clauseSeparator`, `fixStrategies`, `isFixStrategyName`                                                        | The named fix strategies, so a rule can reuse one or a config can look one up by name    |
| `compileRule`, `RuleError`                                                                                     | Turning a `Rule` into its compiled regex, and the error a malformed one throws           |
| `scopeSupportsFile`                                                                                            | Whether a scope can read a given path, which is how the config check rejects a dead rule |
| `MissingPeerDependencyError`, `UnsupportedPeerDependencyError`, `JsxUnsupportedError`, `UnsupportedScopeError` | Catching a parser problem by type rather than by message                                 |
| `looksBinary`, `stripBom`                                                                                      | The two text checks `scanText` runs first, exposed for a caller doing its own reading    |
| `DEFAULT_IGNORE`                                                                                               | The directories every scan skips, for a caller building its own ignore list              |
| `relativeToRoot`, `toPosix`                                                                                    | The path normalization findings are reported in, which is POSIX on every platform        |
| `chars`                                                                                                        | Every banned character this package knows about, by name, built from its code point      |

Rules, presets and the config loader live behind their own entry points, `charcheck/config`
and `charcheck/presets`, so a config file pulls in neither the scanner nor the CLI. See
[Configuration](configuration.md) and [Presets](presets.md).

The reporters are deliberately not exported. A report is a presentation decision, and the
shape of a finding is the contract worth keeping stable.
