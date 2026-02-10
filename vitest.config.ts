import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/hdrify/src/**/*.test.ts',
      'packages/hdrify-tests/src/**/*.test.ts',
      'packages/cli-tests/src/**/*.test.ts',
    ],
    environment: 'node',
    watch: false,
    isolate: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        '**/node_modules',
        '**/coverage',
        '**/scripts',
        '**/dist',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test',
        '**/tests',
        '**/*.d.ts',
        '**/vitest.config.ts',
        '**/vitest.config.js',
        '**/publish',
      ]
    }
  },
  
});
