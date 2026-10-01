import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The default five seconds is lost under load by whichever test pays for a cold peer
    // import first, a different one each run. A test that genuinely hangs still fails.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      // A ratchet at the measured numbers, rounded down. Raise them as coverage rises; a
      // drop below fails `pnpm run test:coverage`, which CI runs on one platform.
      thresholds: { statements: 94, branches: 90, functions: 96, lines: 95 },
    },
  },
});
