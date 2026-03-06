import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 10000,
    coverage: {
      reporter: ['text', 'json'],
      exclude: ['node_modules', 'test/**']
    }
  }
});
