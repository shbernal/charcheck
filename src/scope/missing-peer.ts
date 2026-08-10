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
    super(
      `The "${scope}" scope needs "${packageName}" ${supportedRange}, and ${found} does not ` +
        `provide the API it parses with. Install a supported version, or drop the rules that ` +
        `use this scope.`,
    );
    this.name = 'UnsupportedPeerDependencyError';
    this.packageName = packageName;
    this.installedVersion = installedVersion;
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
