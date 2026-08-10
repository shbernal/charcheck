import type { CharcheckConfig } from './types.js';

/**
 * Identity at runtime; it exists so a config file gets completion and type errors without
 * importing anything else.
 */
export function defineConfig(config: CharcheckConfig): CharcheckConfig {
  return config;
}
