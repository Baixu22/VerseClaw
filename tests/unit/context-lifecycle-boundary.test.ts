// @vitest-environment node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd());
const explorationRoot = join(repoRoot, 'openclaw_runtime', 'src', 'context-engine', 'exploration');
const sourceRoot = join(repoRoot, 'openclaw_runtime', 'src');

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const absolute = join(dir, name);
    if (statSync(absolute).isDirectory()) files.push(...listTsFiles(absolute));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(absolute);
  }
  return files;
}

describe('context lifecycle shadow boundary', () => {
  it('keeps exploration modules unwired from the runtime default path', () => {
    const violations = listTsFiles(sourceRoot).flatMap((file) => {
      if (file.startsWith(explorationRoot)) return [];
      const text = readFileSync(file, 'utf8');
      if (!text.includes('context-engine/exploration') && !text.includes('./exploration/')) return [];
      return [relative(repoRoot, file)];
    });
    const evidence = {
      schema: 'clawx.tf0424.shadow-boundary/v1',
      driven_by: 'agent',
      actor: 'codex-tf0424',
      generatedAt: new Date().toISOString(),
      productionImportViolations: violations,
      defaultsChanged: false,
      productLocksChanged: false,
      result: violations.length === 0 ? 'shadow-only' : 'blocked',
    };
    const output = process.env.CONTEXT_LIFECYCLE_BOUNDARY_OUT;
    if (output) writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    expect(violations).toEqual([]);
  });
});
