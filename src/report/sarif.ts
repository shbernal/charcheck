import type { Finding } from '../types.js';
import { listed } from './summary.js';
import type { ListOptions } from './summary.js';

/**
 * The smallest SARIF 2.1.0 document GitHub code scanning accepts, so findings become
 * annotations on a pull request. One rule per config rule id, one result per finding.
 */
export const SARIF_VERSION = '2.1.0';

const SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

export interface SarifOptions extends ListOptions {
  toolVersion?: string;
}

export function formatSarif(all: readonly Finding[], options: SarifOptions = {}): string {
  const findings = listed(all, options);
  const rules = new Map<string, { id: string; shortDescription: { text: string } }>();
  for (const finding of findings) {
    if (!rules.has(finding.ruleId)) {
      rules.set(finding.ruleId, {
        id: finding.ruleId,
        shortDescription: { text: finding.message },
      });
    }
  }

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
        results: findings.map((finding) => ({
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
                  endColumn: finding.endColumn,
                },
              },
            },
          ],
        })),
      },
    ],
  };

  return JSON.stringify(document, null, 2);
}
