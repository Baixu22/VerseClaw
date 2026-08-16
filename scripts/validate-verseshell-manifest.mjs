#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSourceBundle } from './verseshell-bundle.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedFacade = [
  ['read_file', 'file.view'],
  ['search_content', 'repo.search'],
  ['run_command', 'exec.run'],
  ['result_query', 'result.query'],
];

function validateFacadeSource(root, issues) {
  const path = resolve(root, 'shared/verseshell/facade.ts');
  if (!existsSync(path)) {
    issues.push('shared/verseshell/facade.ts: missing');
    return;
  }
  const source = readFileSync(path, 'utf8');
  const catalogStart = source.indexOf('export const CLAWX_VERSESHELL_FACADE = [');
  const catalogEnd = source.indexOf('] as const satisfies', catalogStart);
  const catalogSource = catalogStart >= 0 && catalogEnd > catalogStart
    ? source.slice(catalogStart, catalogEnd)
    : '';
  const pairs = [...catalogSource.matchAll(/name:\s*'([^']+)'[\s\S]*?canonical_op:\s*'([^']+)'/gu)]
    .map((match) => [match[1], match[2]])
    .filter(([name]) => expectedFacade.some(([expected]) => expected === name));
  if (JSON.stringify(pairs) !== JSON.stringify(expectedFacade)) {
    issues.push(`facade order/mapping mismatch: ${JSON.stringify(pairs)}`);
  }
  for (const [name] of expectedFacade) {
    const pattern = new RegExp(`name:\\s*'${name}'[\\s\\S]*?when_to_use:[\\s\\S]*?when_not_to_use:[\\s\\S]*?input_schema:`, 'u');
    if (!pattern.test(source)) issues.push(`facade ${name}: when/not-when descriptions or schema missing`);
  }
}

export async function validateVerseShellManifest({ root = repositoryRoot, mode = 'dev', platform = 'win32-x64' } = {}) {
  if (!['dev', 'package'].includes(mode)) throw new Error(`unsupported validation mode: ${mode}`);
  if (platform !== 'win32-x64') throw new Error(`unsupported packaging platform: ${platform}`);
  const issues = [];
  try {
    await validateSourceBundle({ root, platform: 'win32', arch: 'x64', mode });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  validateFacadeSource(root, issues);
  return { ok: issues.length === 0, mode, platform, issues };
}

async function main() {
  const result = await validateVerseShellManifest({
    root: process.argv.includes('--root')
      ? process.argv[process.argv.indexOf('--root') + 1]
      : repositoryRoot,
    mode: process.argv.includes('--package') ? 'package' : 'dev',
    platform: 'win32-x64',
  });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[verseshell-manifest] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[verseshell-manifest] OK: mode=${result.mode} platform=${result.platform}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[verseshell-manifest] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
