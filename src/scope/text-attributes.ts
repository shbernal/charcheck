/**
 * The attribute allowlist, shared by every scope that reads attributes.
 *
 * It lives here rather than beside one of them because it is a statement about attributes,
 * not about the file they are written in: `markup` and `html` are handed the same list, and
 * a config sets it once at the top level. When it lived in `markup.ts`, the `html` scope
 * imported the Vue extractor to find out what an `alt` attribute is, and the two copies of
 * the rule below had already drifted apart.
 */

/**
 * Attributes whose value is text a user reads. Scanning every attribute would flag class
 * names, URLs and data attributes, so this is an allowlist rather than a denylist. It is
 * configurable, because a design system's own `heading="..."` prop should be reachable
 * without a change here.
 */
export const DEFAULT_TEXT_ATTRIBUTES = [
  'title',
  'alt',
  'placeholder',
  'label',
  'aria-label',
  'aria-description',
  'aria-placeholder',
];

/** `content` renders only on a meta tag; anywhere else it is a component's own prop. */
const META_ONLY_ATTRIBUTE = 'content';

/**
 * Whether this attribute of this tag counts as rendered text.
 *
 * The tag is lowercased before the comparison. parse5 has already done it, and a Vue
 * template has not, so the check is made here once rather than remembered at each caller.
 */
export function allows(
  attributes: ReadonlySet<string>,
  tag: string | undefined,
  name: string,
): boolean {
  if (name === META_ONLY_ATTRIBUTE && !attributes.has(META_ONLY_ATTRIBUTE)) {
    return tag?.toLowerCase() === 'meta';
  }
  return attributes.has(name);
}
