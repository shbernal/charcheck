# Programmatic API

The library is a real product surface, not a side effect of the CLI. It touches no process
state, writes nothing, and never exits.

```ts
import { scan } from '@shbernal/charcheck';

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
