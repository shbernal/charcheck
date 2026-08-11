/**
 * Where a defect that is charcheck's own gets filed.
 *
 * Named once because two error messages carry it, and because the thing it points at has to
 * keep existing: the query string selects an issue form, and renaming that file turns both
 * links into a template chooser with no explanation attached. Only failures charcheck
 * declares its own may carry this. A config error, a missing peer, or a refused JSX file is
 * the user's, and pointing those at a tracker manufactures noise.
 */
export const REPORT_ISSUE_URL =
  'https://github.com/shbernal/charcheck/issues/new?template=agent-report.yml';
