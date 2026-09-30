import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration tests share one Postgres test DB and reset it between
    // tests — running files in parallel would race on that shared state.
    fileParallelism: false,
    // Kilo agent worktrees live inside the repo, so a full `npm test` would
    // otherwise pick up a stale duplicate of this suite and report its
    // failures as ours.
    exclude: ['**/node_modules/**', '**/dist/**', '.kilo/**'],
  },
});
