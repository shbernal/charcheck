/**
 * Suppression markers, found by scanning text rather than by understanding a language.
 *
 * A marker may appear anywhere in a line, which is what lets one syntax work inside `//`,
 * `#`, `<!-- -->` and YAML comments without the scanner knowing which of those it is
 * looking at.
 */

const MARKER = /charcheck-disable-(file|next-line|line)([^\r\n]*)/g;

/**
 * Ends a comment. A rule id list stops here rather than swallowing the closing delimiter,
 * and a delimiter written flush against the last id is stripped back off it.
 *
 * Longest first, so `--}}` is read whole rather than as `}}` leaving a stray `--` behind.
 */
const COMMENT_ENDINGS = ['--}}', '-->', '*/', '}}', '#}'];

const RULE_ID = /^[A-Za-z0-9_.:/-]+$/;

export interface Suppressions {
  /** Rule ids suppressed for the whole file. Empty set with `allFile` means every rule. */
  fileRules: Set<string>;
  allFile: boolean;
  /** 1-based line number to the rule ids suppressed on it. */
  lineRules: Map<number, Set<string>>;
  allLines: Set<number>;
}

interface ParsedIds {
  /** The rule ids the marker names, in the order they were written. */
  ids: string[];
  /**
   * The marker named nothing, so it covers every rule.
   *
   * True only for a bare marker, one followed by nothing but whitespace and its own
   * comment terminator. A marker that names something unreadable suppresses nothing
   * instead, because the two mistakes are indistinguishable from the text and only one of
   * them can be allowed to remove checks.
   */
  blanket: boolean;
}

function parseRuleIds(rest: string): ParsedIds {
  const ids: string[] = [];
  for (const token of rest.trim().split(/\s+/)) {
    if (token.length === 0) continue;

    // No rule id can end in `>`, `*`, `}` or `#`, so a terminator suffix is unambiguously
    // the comment closing rather than part of the id it is written against.
    const ending = COMMENT_ENDINGS.find((end) => token.endsWith(end));
    const id = ending === undefined ? token : token.slice(0, -ending.length);

    // The comment closed. Whatever follows belongs to the file, not to the marker.
    if (id.length === 0) break;
    if (!RULE_ID.test(id)) return { ids, blanket: false };

    ids.push(id);
    if (ending !== undefined) break;
  }
  return { ids, blanket: ids.length === 0 };
}

function suppress(
  target: { all: Set<number>; rules: Map<number, Set<string>> },
  line: number,
  parsed: ParsedIds,
): void {
  if (parsed.blanket) {
    target.all.add(line);
    return;
  }
  if (parsed.ids.length === 0) return;
  const existing = target.rules.get(line);
  if (existing) for (const id of parsed.ids) existing.add(id);
  else target.rules.set(line, new Set(parsed.ids));
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;
const FENCE = /^\s{0,3}(```+|~~~+)/;

export function parseSuppressions(text: string, file = ''): Suppressions {
  const result: Suppressions = {
    fileRules: new Set(),
    allFile: false,
    lineRules: new Map(),
    allLines: new Set(),
  };
  const lines = { all: result.allLines, rules: result.lineRules };

  // In Markdown, a fenced block is an example rather than an instruction. Without this,
  // any document explaining the suppression syntax silently suppresses itself, and the
  // file most likely to explain it is the one most worth checking.
  const markdown = MARKDOWN.test(file);
  let fenced = false;

  const sourceLines = text.split('\n');
  for (let i = 0; i < sourceLines.length; i += 1) {
    const lineNumber = i + 1;
    const source = sourceLines[i]!;

    if (markdown && FENCE.test(source)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    MARKER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKER.exec(source)) !== null) {
      const kind = match[1]!;
      const parsed = parseRuleIds(match[2] ?? '');
      if (kind === 'file') {
        if (parsed.blanket) result.allFile = true;
        else for (const id of parsed.ids) result.fileRules.add(id);
      } else if (kind === 'next-line') {
        suppress(lines, lineNumber + 1, parsed);
      } else {
        suppress(lines, lineNumber, parsed);
      }
    }
  }

  return result;
}

export function isSuppressed(suppressions: Suppressions, ruleId: string, line: number): boolean {
  if (suppressions.allFile || suppressions.fileRules.has(ruleId)) return true;
  if (suppressions.allLines.has(line)) return true;
  return suppressions.lineRules.get(line)?.has(ruleId) ?? false;
}
