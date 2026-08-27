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
