import { createColors } from 'picocolors';

import { describeChars, isInvisibleText } from '../chars.js';
import type { Finding } from '../types.js';
import { groupByFile, listed, summarize } from './summary.js';
import type { ListOptions } from './summary.js';

export interface PrettyOptions extends ListOptions {
  color?: boolean;
  /** Source text per file, for the excerpt. Findings alone do not carry it. */
  sources?: Map<string, string>;
  /** Prefixed to the summary when fixes were written. */
  fixedCount?: number;
}

/** Shared with the CLI, so a count reads the same wherever a person meets it. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The excerpt for one finding, from lines split once per file rather than once per finding. */
function lineAt(lines: readonly string[] | undefined, line: number): string | undefined {
  const text = lines?.[line - 1];
  if (text === undefined) return undefined;
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

export function formatPretty(findings: readonly Finding[], options: PrettyOptions = {}): string {
  const c = createColors(options.color);
  const out: string[] = [];
  const summary = summarize(findings);

  for (const [file, forFile] of groupByFile(listed(findings, options))) {
    const lines = options.sources?.get(file)?.split('\n');
    for (const finding of forFile) {
      // On its own line, so a terminal turns it into a link to the exact position.
      out.push(c.underline(`${file}:${String(finding.line)}:${String(finding.column)}`));

      const excerpt = lineAt(lines, finding.line);
      if (excerpt !== undefined) {
        out.push(`  ${excerpt}`);
        const caret = '^'.repeat(Math.max(1, finding.endColumn - finding.column));
        out.push(`  ${' '.repeat(Math.max(0, finding.column - 1))}${c.red(caret)}`);
      }

      const label = finding.severity === 'error' ? c.red('error') : c.yellow('warn');
      // A character that renders as nothing leaves an unremarkable excerpt and a caret
      // pointing at apparent whitespace, so name it. Unless the message already did.
      const named = describeChars(finding.match);
      const detail =
        isInvisibleText(finding.match) && !finding.message.includes(named) ? ` (${named})` : '';
      out.push(`  ${label}  ${c.dim(finding.ruleId)}  ${finding.message}${detail}`);
      out.push('');
    }
  }

  if (options.fixedCount) {
    out.push(
      c.green(
        `Fixed ${plural(options.fixedCount, 'finding')}. Read the diff: a fix is a guess about prose.`,
      ),
    );
  }

  if (findings.length === 0) {
    out.push(c.green('No banned characters found.'));
  } else {
    const parts = [plural(summary.errors, 'error'), plural(summary.warnings, 'warning')];
    const where = `in ${plural(summary.files, 'file')}`;
    const fixable =
      summary.fixable > 0 ? c.dim(` (${String(summary.fixable)} fixable with --fix)`) : '';
    out.push(`${parts.join(', ')} ${where}${fixable}`);
  }

  return out.join('\n');
}
