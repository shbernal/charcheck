import { lineBreaksIn } from '../position.js';
import type { Finding } from '../types.js';
import { listed } from './summary.js';
import type { ListOptions } from './summary.js';

/**
 * The smallest SARIF 2.1.0 document GitHub code scanning accepts, so findings become
 * annotations on a pull request. One rule per config rule id, one result per finding.
 */
const SARIF_VERSION = '2.1.0';

const SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

export interface SarifOptions extends ListOptions {
  toolVersion?: string;
  /**
   * The findings a suppression marker silenced.
   *
   * SARIF has a first-class mechanism for exactly this, so these are emitted as results
   * rather than as a tally: a viewer already knows to fold them away, and code scanning does
   * not raise an alert for one. It is the one format where the finding itself is the right
   * thing to carry, since the reader can hide it and the count cannot be un-summarized.
   */
  suppressed?: readonly Finding[];
}

/** `inSource`, because every suppression charcheck honours is a marker in the file. */
const IN_SOURCE = [{ kind: 'inSource' }];

/**
 * Where the match ends.
 *
 * A region with no `endLine` is a region on `startLine`, and its `endColumn` has to be
 * greater than `startColumn` or the document is malformed. `endColumn` is the column just
 * past the match, so for a match that crosses a line break it is a column on a later line
 * and reads as backwards. The line it belongs to is `finding.match` away, which is why no
 * field on the finding has to carry it.
 *
 * Emitted only when the match actually spans lines, so the overwhelmingly common
 * single-line result keeps the exact shape code scanning has been ingesting.
 */
function regionEnd(finding: Finding): object {
  const breaks = lineBreaksIn(finding.match);
  return breaks > 0 ? { endLine: finding.line + breaks } : {};
}

export function formatSarif(all: readonly Finding[], options: SarifOptions = {}): string {
  const findings = listed(all, options);
  // Narrowed by --quiet the same way the reported findings are. A flag that lists errors
  // only has no reason to make an exception for the silenced warnings.
  const suppressed = listed(options.suppressed ?? [], options);
  const rules = new Map<string, { id: string; shortDescription: { text: string } }>();
  for (const finding of [...findings, ...suppressed]) {
    if (!rules.has(finding.ruleId)) {
      rules.set(finding.ruleId, {
        id: finding.ruleId,
        shortDescription: { text: finding.message },
      });
    }
  }

  const result = (finding: Finding, silenced: boolean): object => ({
    ruleId: finding.ruleId,
    level: finding.severity === 'error' ? 'error' : 'warning',
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.file },
          region: {
            startLine: finding.line,
            startColumn: finding.column,
            ...regionEnd(finding),
            endColumn: finding.endColumn,
          },
        },
      },
    ],
    ...(silenced ? { suppressions: IN_SOURCE } : {}),
  });

  const document = {
    $schema: SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'charcheck',
            informationUri: 'https://github.com/shbernal/charcheck',
            ...(options.toolVersion ? { version: options.toolVersion } : {}),
            rules: [...rules.values()],
          },
        },
        results: [
          ...findings.map((finding) => result(finding, false)),
          ...suppressed.map((finding) => result(finding, true)),
        ],
      },
    ],
  };

  return JSON.stringify(document, null, 2);
}
