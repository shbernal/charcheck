/**
 * The extension test each parser-backed extractor opens with, and the one `scopeSupportsFile`
 * answers the config check with.
 *
 * One function so the two can never disagree. They are asked the same question at different
 * times, the config check before the scan and the extractor during it, and an extractor that
 * accepted a file the check rejects, or the reverse, would be a rule that validates and then
 * reads nothing.
 */
export function matchesExtension(extensions: readonly string[], file: string): boolean {
  const lower = file.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}
