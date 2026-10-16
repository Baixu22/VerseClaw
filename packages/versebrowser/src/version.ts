/**
 * Single source of truth for the product version.
 *
 * The version is read from `package.json` instead of being duplicated as a
 * literal, so `package.json`, `vb --version` and the MCP handshake can never
 * drift apart again. The relative path resolves the same way from source
 * (`src/version.ts` → `../package.json`) and from the build output
 * (`dist/version.js` → `../package.json`).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: unknown };

export const VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
