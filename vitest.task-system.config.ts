import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';
export default defineConfig({ plugins: baseConfig.plugins, resolve: baseConfig.resolve, test: { environment:'node', include:['tests/unit/durable-task-*.test.ts'],testTimeout:30_000,maxWorkers:2 } });
