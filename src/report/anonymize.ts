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

    // From the first inner dot onward is the extension, and extensions are kept whole. They
    // decide which scope can read the file, which makes them among the most diagnostic parts
    // of a pattern, and the dotted parts of a filename are conventions rather than names:
    // `.d.ts`, `.test.ts`, `.config.js`.
    const cut = rest.indexOf('.');
    if (cut === -1) return dot + names(rest, kind);
    return dot + names(rest.slice(0, cut), kind) + rest.slice(cut);
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
