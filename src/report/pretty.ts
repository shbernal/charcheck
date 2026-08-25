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
  /**
   * How many findings the baseline accounted for. They are not listed and do not fail the
   * run, so the count is the only thing that says the report is smaller than the tree.
   */
  baselined?: number;
  /**
   * How many findings a suppression marker silenced. Counted, never listed: a silence
   * somebody wrote on purpose and re-read on every run is how people learn to stop reading
   * the last line. One number answers whether anything went quiet, which is the question.
   */
  suppressed?: number;
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
    // "new" only when a baseline hid something, since otherwise it would suggest a baseline
    // is in play when none is.
    out.push(
      c.green(
        options.baselined ? 'No new banned characters found.' : 'No banned characters found.',
      ),
    );
    // The line this whole count exists for. With no findings there is no summary clause to
    // carry it, and a run in which every finding was silenced would otherwise print exactly
    // what a run over a clean tree prints, down to the byte.
    if (options.suppressed) {
      out.push(c.dim(`${plural(options.suppressed, 'finding')} suppressed by a marker.`));
    }
  } else {
    const parts = [plural(summary.errors, 'error'), plural(summary.warnings, 'warning')];
    if (options.suppressed) parts.push(`${String(options.suppressed)} suppressed`);
    const where = `in ${plural(summary.files, 'file')}`;
    const fixable =
      summary.fixable > 0 ? c.dim(` (${String(summary.fixable)} fixable with --fix)`) : '';
    out.push(`${parts.join(', ')} ${where}${fixable}`);
  }

  if (options.baselined) {
    out.push(c.dim(`${plural(options.baselined, 'finding')} accounted for by the baseline.`));
  }

  return out.join('\n');
}
