// @vitest-environment node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronRoot = resolve(process.cwd(), 'electron');
const transportOwners = new Set([
  join('utils', 'network-pool.ts'),
  join('utils', 'proxy-fetch.ts'),
]);

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...listTypeScriptFiles(absolute));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

describe('Electron network fetch boundary', () => {
  it('routes direct fetch calls through the proxy-aware pool boundary', () => {
    const directFetchPattern = /(?<!\.)\bfetch\s*\(/u;
    const proxyAwareCallPattern = /\bproxyAwareFetch\s*\(/u;
    const files = listTypeScriptFiles(electronRoot);
    let proxyAwareCallSites = 0;
    const violations = files.flatMap((file) => {
      const relativePath = relative(electronRoot, file);
      const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
      proxyAwareCallSites += lines.filter((line) => proxyAwareCallPattern.test(line)).length;
      if (transportOwners.has(relativePath)) return [];
      return lines.flatMap((line, index) => directFetchPattern.test(line)
        ? [`${relativePath}:${index + 1}: ${line.trim()}`]
        : []);
    });
    const output = process.env.RESOURCE_FETCH_BOUNDARY_OUT;
    if (output) {
      writeFileSync(output, JSON.stringify({
        schema: 'clawx.tf0413.electron-fetch-boundary/v1',
        driven_by: 'agent',
        actor: 'codex-tf0413',
        generatedAt: new Date().toISOString(),
        scannedFiles: files.length,
        transportOwners: [...transportOwners],
        proxyAwareCallSites,
        directFetchViolations: violations,
      }, null, 2) + '\n');
    }

    expect(violations).toEqual([]);
    expect(proxyAwareCallSites).toBeGreaterThanOrEqual(8);
  });
});