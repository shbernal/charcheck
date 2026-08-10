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
