import path from 'node:path';

/**
 * Every path that crosses a boundary is POSIX. The dev and CI machines here are Windows,
 * and a backslash reaching a glob matcher, a config `exclude`, or a reporter's output is a
 * bug that only shows up on one platform.
 */
export function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}

/** A file's path relative to the root, POSIX, with no leading `./`. */
export function relativeToRoot(root: string, file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  const posix = toPosix(relative);
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

/**
 * One entry of a run's path restriction, spelled the single way everything compares it:
 * root-relative, POSIX, no trailing slash.
 *
 * The trailing slash is what a shell adds when it completes a directory name, and it is
 * never part of a file's own path, so `src/` and `src` have to arrive here as one string
 * or a directory reaches nothing.
 */
export function restrictionPath(root: string, file: string): string {
  return relativeToRoot(root, file).replace(/\/+$/, '');
}

/**
 * Whether a path relative to some root climbs out of it: `..` or anything below it, or a
 * path that is absolute and so was never relative to the root at all. Read as POSIX, which
 * is how a glob and a finding's `file` are both spelled.
 */
export function escapesRoot(relative: string): boolean {
  const normal = path.posix.normalize(toPosix(relative));
  return (
    path.posix.isAbsolute(normal) ||
    path.win32.isAbsolute(normal) ||
    normal === '..' ||
    normal.startsWith('../')
  );
}

/**
 * Whether a file, absolute or relative to the root, lies strictly below it. Decided from the
 * resolved path rather than the string, so `docs/../../x` is caught as readily as `../x`.
 */
export function isInsideRoot(root: string, file: string): boolean {
  const relative = path.relative(root, path.resolve(root, file));
  return relative.length > 0 && !escapesRoot(relative);
}
