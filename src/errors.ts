/**
 * What a thrown thing turns out to be.
 *
 * A `catch` binding is `unknown`, and every caller that wants to tell a user what happened
 * needs the same two facts out of it: the syscall code when there is one, since `ENOENT` is
 * the whole answer, and the message when there is not. Written out at each site, the cast
 * and the fallback drifted apart between them.
 */

/** A syscall error's code, when the thrown thing carries one. */
export function errorCode(cause: unknown): string | undefined {
  return (cause as { code?: string } | undefined)?.code;
}

/** The code, or the message when there is no code. What a person needs to read. */
export function describeError(cause: unknown): string {
  return errorCode(cause) ?? (cause as Error).message;
}
