import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    passWithNoTests: false,
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup-agent-dev-node.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    pool: 'forks',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
    server: {
      deps: {
        external: [/scripts\/.*\.mjs$/],
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
});
