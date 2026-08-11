/**
 * Escaping a literal string for use inside a regular expression.
 *
 * Shared rather than written twice, because both callers escape text a user chose, a rule's
 * `chars` entry and a commit message's comment character, and a second copy of this class
 * that drifts is a matching bug in whichever caller was not updated with it.
 */

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

export function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIALS, '\\$&');
}
