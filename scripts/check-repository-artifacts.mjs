#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseFrontmatter } from '../harness/src/specs.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function isLocalArtifact(path, policy) {
  return policy.localOnlyFiles.includes(path)
    || policy.retiredTests.includes(path)
    || policy.localOnlyDirectories.some((directory) => path === directory || path.startsWith(`${directory}/`));
}

export function checkRepositoryArtifacts(root = ROOT) {
  const policy = JSON.parse(readFileSync(join(root, 'scripts/repository-artifacts.json'), 'utf8'));
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  }).split('\0').filter(Boolean));
  const issues = [];
  for (const path of tracked) {
    if (isLocalArtifact(path, policy)) issues.push(`Local artifact is still tracked: ${path}`);
  }
  for (const path of policy.requiredInputs) {
    if (!tracked.has(path)) issues.push(`Required source input is not tracked: ${path}`);
    if (!existsSync(join(root, path))) issues.push(`Required source input is missing: ${path}`);
  }
  for (const path of policy.retiredTests) {
    if (existsSync(join(root, path))) issues.push(`Retired test is still in default discovery: ${path}`);
  }

  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: root,
    input: `${policy.requiredInputs.join('\0')}\0`,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (ignored.error || ![0, 1].includes(ignored.status)) {
    throw ignored.error ?? new Error(`Cannot inspect ignore rules: ${ignored.stderr}`);
  }
  for (const path of ignored.stdout.split('\0').filter(Boolean)) {
    issues.push(`Required source input is ignored: ${path}`);
  }

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commands = Object.values(packageJson.scripts ?? {}).map((command) => ({ source: 'package.json', command }));
  for (const path of tracked) {
    if (!path.startsWith('harness/specs/tasks/') || !path.endsWith('.md')) continue;
    const text = readFileSync(join(root, path), 'utf8');
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) continue;
    const { data: spec } = parseFrontmatter(text);
    for (const command of spec?.requiredTests ?? []) commands.push({ source: path, command });
  }
  for (const { source, command } of commands) {
    if (typeof command !== 'string') continue;
    for (const path of policy.retiredTests) {
      if (command.includes(path)) issues.push(`Retired test remains an execution prerequisite: ${source}: ${path}`);
    }
  }

  return { schemaVersion: 1, trackedPaths: tracked.size, issues, passed: issues.length === 0 };
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, json: { type: 'boolean' } } });
    const result = checkRepositoryArtifacts(values.root ? resolve(values.root) : ROOT);
    console.log(values.json
      ? JSON.stringify(result, null, 2)
      : result.passed
        ? `Repository artifact retention passed (${result.trackedPaths} tracked paths).`
        : result.issues.join('\n'));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
