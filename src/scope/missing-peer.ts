import { REPORT_ISSUE_URL } from '../report-url.js';

/**
 * Optional peer dependencies are imported lazily, so a consumer that only scans raw text
 * installs nothing extra. When one is genuinely needed, the failure must name the package
 * and the rule that asked for it, never surface as a module-not-found stack trace.
 */
export class MissingPeerDependencyError extends Error {
  readonly packageName: string;

  constructor(packageName: string, scope: string, cause?: unknown) {
    super(
      `The "${scope}" scope needs the optional peer dependency "${packageName}", ` +
        `which is not installed. Add it as a devDependency to use this scope.`,
    );
    this.name = 'MissingPeerDependencyError';
    this.packageName = packageName;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Whether the installed version reaches the floor the supported range names.
 *
 * This is what separates the two failures the class covers, and only one of them is worth a
 * tracker link. Below the floor is an install the user can fix by upgrading. At or above it,
 * the package is one charcheck claims to support and still cannot read, which means a major
 * moved the API again and charcheck has not caught up.
 *
 * An absent or unparseable version counts as at or above, because that is the shape the
 * newer case actually arrives in: the package resolved, offered no API either reader knows,
 * and could not be identified. Guessing the other way would withhold the link from exactly
 * the report that is wanted.
 */
function meetsSupportedFloor(
  installedVersion: string | undefined,
  supportedRange: string,
): boolean {
  const floor = Number(/(\d+)/.exec(supportedRange)?.[1]);
  const major = Number(/^\D*(\d+)/.exec(installedVersion ?? '')?.[1]);
  if (!Number.isFinite(floor) || !Number.isFinite(major)) return true;
  return major >= floor;
}

/**
 * Installed, resolvable, and still unusable. TypeScript 7 is the case this exists for: it
 * moved the compiler API out of the package root, so the import succeeds and every call
 * against it fails. Without this the user sees a property access on undefined.
 */
export class UnsupportedPeerDependencyError extends Error {
  readonly packageName: string;
  readonly installedVersion: string | undefined;

  constructor(
    packageName: string,
    scope: string,
    installedVersion: string | undefined,
    supportedRange: string,
  ) {
    const found =
      installedVersion === undefined ? 'the installed copy' : `version ${installedVersion}`;
    const advice = meetsSupportedFloor(installedVersion, supportedRange)
      ? `That is inside the range charcheck supports, so this one is charcheck's to fix. ` +
        `Please report it with the "${packageName}" version: ${REPORT_ISSUE_URL} Until a ` +
        `release carries it, pin a version this one can parse with, or drop the rules that ` +
        `use this scope.`
      : `Install a supported version, or drop the rules that use this scope.`;
    super(
      `The "${scope}" scope needs "${packageName}" ${supportedRange}, and ${found} does not ` +
        `provide the API it parses with. ${advice}`,
    );
    this.name = 'UnsupportedPeerDependencyError';
    this.packageName = packageName;
    this.installedVersion = installedVersion;
  }
}

/**
 * Installed, usable, and not for this file. TypeScript 7 leaves only a scanner, and a
 * scanner cannot be told it is inside a JSX element: `don't` in JSX text would open a
 * string literal running to the next quote. Refusing the file says so; scanning it anyway
 * would report text nobody wrote and miss text somebody did.
 */
export class JsxUnsupportedError extends Error {
  readonly file: string;

  constructor(file: string, scope: string) {
    super(
      `The "${scope}" scope cannot read JSX on this TypeScript, which provides a scanner ` +
        `and no parser: ${file}. Install TypeScript 5 or 6 to scan JSX, or exclude these ` +
        `files from the rule.`,
    );
    this.name = 'JsxUnsupportedError';
    this.file = file;
  }
}

/**
 * A failure to resolve the module is a missing dependency; anything else (a syntax error
 * inside the package, a broken install) is a real error and must not be disguised.
 */
function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

export async function importPeer<T>(
  packageName: string,
  scope: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (cause) {
    if (isModuleNotFound(cause)) {
      throw new MissingPeerDependencyError(packageName, scope, cause);
    }
    throw cause;
  }
}
