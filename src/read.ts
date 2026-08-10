import { readFile } from 'node:fs/promises';

export type ReadOutcome =
  { ok: true; text: string } | { ok: false; reason: string; missing: boolean };

/**
 * Read a file as UTF-8, turning every failure into a value.
 *
 * A single unreadable file must not end a run over a whole tree: a permission error on one
 * path is worth a warning, not a stack trace instead of the other nine hundred results.
 * Binary content is skipped later, by the scanner, which already sniffs it.
 */
export async function readTextFile(file: string): Promise<ReadOutcome> {
  try {
    return { ok: true, text: await readFile(file, 'utf8') };
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    // A path that vanished between globbing and reading is normal: a run against staged
    // files races the working tree by nature.
    const missing = code === 'ENOENT' || code === 'EISDIR';
    return { ok: false, missing, reason: code ?? (cause as Error).message };
  }
}
