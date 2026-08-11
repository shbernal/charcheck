/**
 * Which failures point at the tracker.
 *
 * The link is a claim about whose bug it is, so it is worth a test in both directions. A
 * user error carrying it manufactures noise in the tracker; a charcheck error missing it is
 * a defect nobody reports, which for this tool means a scan that quietly reads nothing and
 * exits 0.
 *
 * The assertions match on the URL rather than on the sentence around it, so rewording a
 * message stays free.
 */

import { describe, expect, it } from 'vitest';

import {
  JsxUnsupportedError,
  MissingPeerDependencyError,
  UnsupportedPeerDependencyError,
} from '../src/scope/missing-peer.js';
import { UnknownTokenKindError } from '../src/scope/token-kinds.js';
import { REPORT_ISSUE_URL } from '../src/report-url.js';

describe('errors that are charcheck s own', () => {
  it('points a missing syntax kind at the tracker', () => {
    const message = new UnknownTokenKindError(['EndOfFile', 'EndOfFileToken']).message;
    expect(message).toContain(REPORT_ISSUE_URL);
    expect(message).toContain('EndOfFile');
  });

  it('points an in-range peer that offers no usable API at the tracker', () => {
    const error = new UnsupportedPeerDependencyError('typescript', 'strings', '8.0.0', '>=5');
    expect(error.message).toContain(REPORT_ISSUE_URL);
  });

  it('does the same when the version could not be read, which is how that case arrives', () => {
    const error = new UnsupportedPeerDependencyError('typescript', 'strings', undefined, '>=5');
    expect(error.message).toContain(REPORT_ISSUE_URL);
  });
});

describe('errors that are the user s', () => {
  it('leaves a peer below the supported floor without a tracker link', () => {
    const error = new UnsupportedPeerDependencyError('typescript', 'strings', '4.9.5', '>=5');
    expect(error.message).not.toContain(REPORT_ISSUE_URL);
    expect(error.message).toContain('Install a supported version');
  });

  it('leaves a missing peer without one', () => {
    expect(new MissingPeerDependencyError('micromark', 'markdown').message).not.toContain(
      REPORT_ISSUE_URL,
    );
  });

  it('leaves a refused JSX file without one, since it is a stated limitation', () => {
    expect(new JsxUnsupportedError('site/Card.tsx', 'strings').message).not.toContain(
      REPORT_ISSUE_URL,
    );
  });
});
