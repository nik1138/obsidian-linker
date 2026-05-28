import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    timeout: 30000,
    include: ['test/**/*.test.ts', 'test/**/*.simple.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'test/fixtures/'],
    },
  },
});
