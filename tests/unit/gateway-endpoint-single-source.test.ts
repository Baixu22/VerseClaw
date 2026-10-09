import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PORTS } from '../../electron/utils/config';
import {
  GATEWAY_HOST_PORT_PAIRS,
  GATEWAY_HOST_PORT_REGEX_SOURCE,
  GATEWAY_HTTP_ORIGINS,
  GATEWAY_LOOPBACK_HOSTS,
  GATEWAY_WEB_REQUEST_URL_FILTERS,
  OPENCLAW_GATEWAY_PORT,
  formatGatewayHttpOrigins,
} from '../../shared/gateway-endpoint';

const ROOT = process.cwd();
const SCANNED_ROOTS = ['electron', 'src', 'shared'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.cjs', '.json'];
const PORT_LITERAL = '18789';
// The only place the port may be written down. Everything else derives from it.
const CONSTANT_MODULE = 'shared/gateway-endpoint.ts';

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (SOURCE_EXTENSIONS.some((suffix) => entry.name.endsWith(suffix))) {
      files.push(relative(ROOT, full).split('\\').join('/'));
    }
  }
  return files;
}

// Regression for issue #89. The Gateway port was duplicated as a literal in Main
// defaults, renderer stores, the mock bridge, the Control-UI URL filter, the
// project-rules detector (regexes *and* user-facing copy) and localized copy. A
// port change then silently stopped matching instead of failing loudly.
describe('gateway endpoint single source', () => {
  it('keeps the port literal only in its constant module', () => {
    const offences: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        if (file === CONSTANT_MODULE) continue;
        if (readFileSync(join(ROOT, file), 'utf8').includes(PORT_LITERAL)) offences.push(file);
      }
    }
    expect(offences).toEqual([]);
  });

  it('keeps the constant module present so the exemption cannot go stale', () => {
    expect(existsSync(join(ROOT, CONSTANT_MODULE))).toBe(true);
    expect(readFileSync(join(ROOT, CONSTANT_MODULE), 'utf8')).toContain(PORT_LITERAL);
  });

  it('derives host, origin, URL-filter and regex forms from the port', () => {
    expect(OPENCLAW_GATEWAY_PORT).toBe(18789);
    expect([...GATEWAY_LOOPBACK_HOSTS]).toEqual(['127.0.0.1', 'localhost']);
    expect([...GATEWAY_HOST_PORT_PAIRS]).toEqual(['127.0.0.1:18789', 'localhost:18789']);
    expect([...GATEWAY_HTTP_ORIGINS]).toEqual(['http://127.0.0.1:18789', 'http://localhost:18789']);
    expect([...GATEWAY_WEB_REQUEST_URL_FILTERS]).toEqual([
      'http://127.0.0.1:18789/*',
      'http://localhost:18789/*',
    ]);
    expect(formatGatewayHttpOrigins()).toBe('`http://127.0.0.1:18789` or `http://localhost:18789`');
  });

  it('escapes the derived regex source so the detector matches the real endpoint', () => {
    const pattern = new RegExp(GATEWAY_HOST_PORT_REGEX_SOURCE);
    expect(pattern.test('http://127.0.0.1:18789/control')).toBe(true);
    expect(pattern.test('http://localhost:18789')).toBe(true);
    // Unescaped dots would match this; the derived source must not.
    expect(pattern.test('127x0x0x1:18789')).toBe(false);
  });

  it('wires the Main port constant to the same value', () => {
    expect(PORTS.OPENCLAW_GATEWAY).toBe(OPENCLAW_GATEWAY_PORT);
  });
});
