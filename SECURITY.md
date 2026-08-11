# Security policy

## Supported versions

charcheck is pre-1.0. Only the latest published version receives fixes.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting: go to the
[Security tab](https://github.com/shbernal/charcheck/security/advisories/new) and open a
draft advisory. That reaches the maintainer directly and keeps the details private until
there is a fix.

Expect an acknowledgement within a few days. This is a small project maintained by one
person, so please allow reasonable time before disclosing publicly.

## What is in scope

charcheck runs in developer environments and in CI, and it does two things that carry real
risk:

- **It loads your config file by importing it.** `charcheck.config.js` and
  `charcheck.config.ts` are executed as code. That is by design and is how every linter in
  this ecosystem works, but it means a repo you have not read can run code the moment you
  run charcheck in it. Treat a cloned repo's config the way you would treat its build
  scripts.
- **`--fix` rewrites files, and `--staged --fix` stages what it changed.** A bug that
  corrupts content, or that writes outside the config's directory, is a security-relevant
  bug and not merely a correctness one.

Also in scope: path traversal through globs or positional paths, anything that lets a
crafted input file cause a write outside the project root, and denial of service from a
crafted `pattern` (a regular expression is compiled from your config, so catastrophic
backtracking is possible if you write it, but a crafted _scanned file_ should never be able
to hang the scanner).

## What is not in scope

- The fact that config files execute. See above. That is the design.
- A `pattern` you wrote yourself that backtracks catastrophically.
- Vulnerabilities in an optional parser peer: `typescript`, `@vue/compiler-sfc`,
  `micromark`, `parse5`. Report those upstream, though
  telling us is useful if charcheck's usage makes them reachable in an unusual way.
- charcheck failing to flag a character. That is a bug, sometimes an important one, but it
  is not a vulnerability. Open a normal issue.
