import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment:'node', include:['tests/unit/durable-task-*.test.ts'],testTimeout:30_000,maxWorkers:2 } });
