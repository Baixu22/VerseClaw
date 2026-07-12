// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { randomUUID } from 'node:crypto';

import { runShadow, runShadowSync } from '../runtime-core/shadow-safety-boundary.js';

function shadowId(context: string): string {
  return `runtime-spine:${context}:${randomUUID()}`;
}

export const shadowSafetyBoundary = {
  execute<T>(context: string, fn: () => T): T {
    const result = runShadowSync('A1', shadowId(context), fn);
    return result.ok ? result.value : (undefined as T);
  },

  async executeAsync<T>(context: string, fn: () => Promise<T>): Promise<T> {
    const result = await runShadow('A1', 'non_io', shadowId(context), async () => fn());
    return result.ok ? result.value : (undefined as T);
  },
};
