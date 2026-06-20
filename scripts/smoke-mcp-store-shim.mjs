/**
 * Dual-purpose module:
 * 1. When loaded via `register()` from `node:module`, resolves `electron-store`
 *    imports to itself so the smoke test controls where the config store lives.
 * 2. When loaded as the `electron-store` replacement, wraps `conf` and writes to
 *    `process.env.CLAWX_USER_DATA_DIR`.
 */
import path from 'node:path';
import { homedir } from 'node:os';
import Conf from 'conf';

// ── Resolve hook (Node 20.6+ register API) ─────────────────────────────
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron-store') {
    return {
      url: import.meta.url,
      format: 'module',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

// ── electron-store replacement ────────────────────────────────────────
const storeCwd = process.env.CLAWX_USER_DATA_DIR?.trim() || path.join(homedir(), '.clawx');

export default class ElectronStore extends Conf {
  /**
   * @param {import('conf').Options & { name?: string; configName?: string }} [options]
   */
  constructor(options = {}) {
    const configName = options.configName || options.name || 'config';
    super({ ...options, cwd: storeCwd, configName });
  }

  static initRenderer() {
    // No-op stub for smoke test compatibility.
  }

  async openInEditor() {
    // No-op stub for smoke test compatibility.
  }
}
