import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'master',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
