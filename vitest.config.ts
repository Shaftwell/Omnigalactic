import { defineConfig } from 'vitest/config';

// Standalone from vite.config.ts so the app's PWA/React plugins don't load
// during unit tests. Pure libs run in node; the markdown suite opts into
// jsdom via a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
