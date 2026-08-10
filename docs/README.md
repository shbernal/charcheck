# charcheck documentation

The [project README](../README.md) covers what charcheck is for and how to get it running.
These pages are the full reference.

| Page                                  | Read it when                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| [Getting started](getting-started.md) | Wiring charcheck into scripts, hook managers, or CI                          |
| [Scopes](scopes.md)                   | Deciding whether a rule should read a whole file, its strings, or its markup |
| [Configuration](configuration.md)     | Writing rules, fixes, or suppression comments                                |
| [Command line](cli.md)                | Looking up a flag, an exit code, or what `--staged` actually reads           |
| [Programmatic API](api.md)            | Calling charcheck from a script or a test instead of the CLI                 |
| [Presets](presets.md)                 | Reaching for a ready-made character list                                     |
| [Limitations](limitations.md)         | Something is not being caught and you want to know whether that is expected  |

## The one thing worth reading first

A rule's `scope` decides which part of a file it may match inside, and choosing the wrong
one fails silently: a scan that reads nothing looks exactly like a scan that passed. If
charcheck reports success on a file you know contains a banned character, start at
[Scopes](scopes.md).
