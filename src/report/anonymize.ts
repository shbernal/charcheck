import { VIRTUAL_PATTERN } from '../config/schema.js';

/**
 * Glob patterns with the names taken out and the shape left in.
 *
 * `--report-issue` prints the rules a config resolved to, and a glob carries real names:
 * `docs/acme-migration/**` is exactly the pattern that ends up in a working config, and the
 * tracker it gets pasted into is public. The obvious alternative, printing a warning and
 * trusting somebody to read the output before sending it, was rejected on purpose. That path
 * is meant to run unattended, and a safety measure that depends on a human reading is not a
 * safety measure in the case that matters. So the names go, always, and there is nothing to
 * approve.
 *
 * What stays is everything that carries diagnostic weight, which is the whole syntax of the
 * pattern: a double star against a single one, the number of segments, brace expansions, the
 * extension, and above all the leading dot on a dotted directory. A dotted directory is only
 * entered when a pattern names it, and that is the commonest reason a report gets filed at
 * all, so destroying that signal would gut the section it appears in.
 */

/** Segments that name nothing: a bare wildcard, or the current or parent directory. */
function isStructural(segment: string): boolean {
  return segment === '' || segment === '.' || segment === '..' || /^[*?]+$/.test(segment);
}

/**
 * Everything glob syntax gives meaning to. Whatever lies between two of these is a name, so
 * `{guide,api}` anonymizes to `{dir1,dir2}` rather than to one opaque blob, and a brace
 * expansion stays readable as one.
 */
const NAME_RUN = /[^*?{}[\]()|!,+@]+/g;

/**
 * Inner dotted parts of a filename that are ecosystem conventions rather than anybody's name,
 * and say something about the file a reader of the report needs: `.d.ts` is a declaration
 * file, `.test.ts` a test. Listed rather than inferred, because nothing about a dot's
 * position tells `.test.ts` from `.acme-internal.ts`.
 */
const CONVENTIONAL_PARTS = new Set(['d', 'test', 'spec', 'config', 'min', 'stories']);

/**
 * A renamer, held across every pattern of every rule in one report.
 *
 * Placeholders are numbered in order of first appearance and memoized by name, which buys
 * two things. Two rules that share a directory keep sharing its placeholder, since the fact
 * that they overlap is part of the report. And the transform is idempotent: running it over
 * its own output assigns the same numbers in the same order and changes nothing, so a report
 * cannot be quietly double-anonymized into a different shape.
 */
export function createGlobAnonymizer(): (pattern: string) => string {
  const placeholders = new Map<string, string>();

  const placeholder = (name: string, kind: 'dir' | 'file'): string => {
    const existing = placeholders.get(name);
    if (existing !== undefined) return existing;
    const assigned = `${kind}${String(placeholders.size + 1)}`;
    placeholders.set(name, assigned);
    return assigned;
  };

  const names = (value: string, kind: 'dir' | 'file'): string =>
    value.replace(NAME_RUN, (run) => placeholder(run, kind));

  const segment = (value: string, kind: 'dir' | 'file'): string => {
    if (isStructural(value)) return value;

    // A leading dot is the signal, not a name, so it is peeled off and put back.
    const dot = value.startsWith('.') ? '.' : '';
    const rest = value.slice(dot.length);

    // Each dotted part is a name of its own, so `x.acme-internal.ts` keeps its shape as two
    // placeholders and an extension rather than letting everything after the first dot
    // through. A dotted part being a convention rather than a name is decided by the list
    // above, never by its position.
    //
    // The final part of a file segment is its extension, and is kept. It decides which scope
    // can read the file, which makes it among the most diagnostic parts of a pattern. A
    // directory has no extension, so all of its parts are names.
    const parts = rest.split('.');
    const extension = kind === 'file' && parts.length > 1 ? parts.pop()! : undefined;
    const named = parts
      .map((part, index) => (index > 0 && CONVENTIONAL_PARTS.has(part) ? part : names(part, kind)))
      .join('.');
    return dot + named + (extension === undefined ? '' : `.${extension}`);
  };

  return (pattern: string): string => {
    // A virtual pattern names a surface rather than a directory, so there is nothing in it
    // to hide and it has to survive intact to be recognizable.
    if (VIRTUAL_PATTERN.test(pattern)) return pattern;

    const segments = pattern.split('/');
    return segments
      .map((value, index) => segment(value, index === segments.length - 1 ? 'file' : 'dir'))
      .join('/');
  };
}

/**
 * Everything in a regular expression source that is syntax rather than text, matched in the
 * order it has to be tried: an escape sequence whole, a character class whole, a counted
 * quantifier, a group prefix, and then any single metacharacter. The `>` closing a named
 * group's name counts as one, so the name between is replaced like any other text.
 *
 * So does any character outside ASCII that is not a letter or a digit, written into the
 * pattern as itself rather than as an escape. That is the banned character the rule is
 * about, which the report escapes and prints, and a dash or an invisible names nobody.
 *
 * A character class is kept verbatim. It is a set of characters rather than a word, and the
 * set is usually the point of the rule: `[\u2013\u2014]` is the report.
 */
const REGEX_SYNTAX =
  /\\u\{[0-9a-fA-F]+\}|\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\\[pPk][{<][^}>]*[}>]|\\c[A-Za-z]|\\[\s\S]|\[(?:\\[\s\S]|[^\]\\])*\]|\{\d+(?:,\d*)?\}|\(\?(?:<[=!]?|[:=!])?|[\^$.|?*+(){}>]|[^\p{L}\p{N}\p{ASCII}]/gu;

/**
 * A rule's `pattern` with the literal text taken out and the syntax left in.
 *
 * A regular expression is diagnostic in its structure exactly as a glob is, and it carries
 * names exactly as a glob does: `Acme Internal\u2014` is a rule about a company. So it gets
 * the glob's treatment rather than `message`'s. Each run of literal text between two pieces
 * of syntax becomes a placeholder, memoized so a word repeated across rules stays
 * recognizably the same word, and the transform is idempotent for the same reason the glob
 * one is.
 */
export function createPatternAnonymizer(): (pattern: string) => string {
  const placeholders = new Map<string, string>();

  const placeholder = (text: string): string => {
    const existing = placeholders.get(text);
    if (existing !== undefined) return existing;
    const assigned = `text${String(placeholders.size + 1)}`;
    placeholders.set(text, assigned);
    return assigned;
  };

  return (pattern: string): string => {
    let output = '';
    let last = 0;
    for (const match of pattern.matchAll(REGEX_SYNTAX)) {
      if (match.index > last) output += placeholder(pattern.slice(last, match.index));
      output += match[0];
      last = match.index + match[0].length;
    }
    if (last < pattern.length) output += placeholder(pattern.slice(last));
    return output;
  };
}
