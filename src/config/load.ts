import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ConfigError, validateConfig } from './schema.js';
import type { LoadedConfig } from './types.js';

/**
 * Search order. `.ts` first because every known consumer writes TypeScript, and the node
 * 24 floor means a bare dynamic import strips the types with no loader involved.
 */
export const CONFIG_FILENAMES = [
  'charcheck.config.ts',
  'charcheck.config.mts',
  'charcheck.config.js',
  'charcheck.config.mjs',
  'charcheck.config.json',
];

const PACKAGE_JSON_KEY = 'charcheck';

export class ConfigNotFoundError extends Error {
  constructor(from: string) {
    super(
      `No charcheck config found, searching upward from ${from}.\n` +
        `Create charcheck.config.ts:\n\n` +
        `  import { defineConfig } from 'charcheck/config';\n\n` +
        `  export default defineConfig({\n` +
        `    rules: [\n` +
        `      { id: 'no-em-dash', chars: ['\\u2014'], include: ['**/*.md'] },\n` +
        `    ],\n` +
        `  });\n`,
    );
    this.name = 'ConfigNotFoundError';
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/** A fresh URL each time, so a config edited between runs in one process is re-read. */
async function importModule(filepath: string): Promise<unknown> {
  const url = pathToFileURL(filepath);
  const module = (await import(`${url.href}?t=${String(Date.now())}`)) as {
    default?: unknown;
  };
  return module.default ?? module;
}

async function readConfigFile(filepath: string): Promise<unknown> {
  if (filepath.endsWith('.json')) {
    return JSON.parse(await readFile(filepath, 'utf8'));
  }
  return importModule(filepath);
}

async function packageJsonConfig(directory: string): Promise<unknown | undefined> {
  const filepath = path.join(directory, 'package.json');
  if (!(await isFile(filepath))) return undefined;
  const parsed = JSON.parse(await readFile(filepath, 'utf8')) as Record<string, unknown>;
  return parsed[PACKAGE_JSON_KEY];
}

/** Where the search starts and where it stops: the filesystem root. */
function parents(from: string): string[] {
  const result: string[] = [];
  let current = path.resolve(from);
  for (;;) {
    result.push(current);
    const next = path.dirname(current);
    if (next === current) return result;
    current = next;
  }
}

export interface FindConfigOptions {
  /** Skip the search entirely and use this file. */
  configPath?: string;
  /** Where the upward search starts. The CLI passes its cwd. */
  from: string;
}

export async function loadConfig(options: FindConfigOptions): Promise<LoadedConfig> {
  if (options.configPath) {
    const filepath = path.resolve(options.from, options.configPath);
    if (!(await isFile(filepath))) {
      throw new ConfigError([`the config file ${filepath} does not exist.`]);
    }
    return finish(await readConfigFile(filepath), filepath);
  }

  for (const directory of parents(options.from)) {
    for (const filename of CONFIG_FILENAMES) {
      const filepath = path.join(directory, filename);
      if (await isFile(filepath)) {
        return finish(await readConfigFile(filepath), filepath);
      }
    }
    const fromPackage = await packageJsonConfig(directory);
    if (fromPackage !== undefined) {
      return finish(fromPackage, path.join(directory, 'package.json'));
    }
  }

  throw new ConfigNotFoundError(path.resolve(options.from));
}

function finish(raw: unknown, filepath: string): LoadedConfig {
  return {
    config: validateConfig(raw, filepath),
    filepath,
    root: path.dirname(filepath),
  };
}
