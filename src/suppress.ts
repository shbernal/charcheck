/**
 * Suppression markers, found by scanning text rather than by understanding a language.
 *
 * A marker may appear anywhere in a line, which is what lets one syntax work inside `//`,
 * `#`, `<!-- -->` and YAML comments without the scanner knowing which of those it is
 * looking at.
 */

const MARKER = /charcheck-disable-(file|next-line|line)([^\r\n]*)/g;

/** Ends a comment; rule ids stop here rather than swallowing the closing delimiter. */
const COMMENT_ENDINGS = new Set(['-->', '*/', '}}', '#}']);

const RULE_ID = /^[A-Za-z0-9_.:/-]+$/;

export interface Suppressions {
  /** Rule ids suppressed for the whole file. Empty set with `allFile` means every rule. */
  fileRules: Set<string>;
  allFile: boolean;
  /** 1-based line number to the rule ids suppressed on it. */
  lineRules: Map<number, Set<string>>;
  allLines: Set<number>;
}

function parseRuleIds(rest: string): string[] {
  const ids: string[] = [];
  for (const token of rest.trim().split(/\s+/)) {
    if (token.length === 0) continue;
    if (COMMENT_ENDINGS.has(token)) break;
    if (!RULE_ID.test(token)) break;
    ids.push(token);
  }
  return ids;
}

function suppress(
  target: { all: Set<number>; rules: Map<number, Set<string>> },
  line: number,
  ids: string[],
): void {
  if (ids.length === 0) {
    target.all.add(line);
    return;
  }
  const existing = target.rules.get(line);
  if (existing) for (const id of ids) existing.add(id);
  else target.rules.set(line, new Set(ids));
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
      const ids = parseRuleIds(match[2] ?? '');
      if (kind === 'file') {
        if (ids.length === 0) result.allFile = true;
        else for (const id of ids) result.fileRules.add(id);
      } else if (kind === 'next-line') {
        suppress(lines, lineNumber + 1, ids);
      } else {
        suppress(lines, lineNumber, ids);
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
