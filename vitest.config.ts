import { defineConfig } from 'vitest/config';

const isProfiling = Boolean(process.env.PROFILE);

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
    ...(isProfiling && {
      fileParallelism: false,
      execArgv: [
        '--cpu-prof',
        '--cpu-prof-dir=./profile-output',
        '--heap-prof',
        '--heap-prof-dir=./profile-output',
      ],
    }),
    coverage: {
      provider: 'v8',
      include: ['packages/hdrify/src/**/*.ts'],
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
