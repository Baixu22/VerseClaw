// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepositoryArtifacts, isLocalArtifact } from '../../scripts/check-repository-artifacts.mjs';
import type { RepositoryArtifactPolicy } from '../../scripts/check-repository-artifacts.mjs';

const root = resolve(__dirname, '../..');
const policy: RepositoryArtifactPolicy = JSON.parse(readFileSync(join(root, 'scripts/repository-artifacts.json'), 'utf8'));
const tempRoots: string[] = [];

function write(rootPath: string, path: string, text = 'fixture\n') {
  mkdirSync(dirname(join(rootPath, path)), { recursive: true });
  writeFileSync(join(rootPath, path), text);
}

function git(rootPath: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: rootPath, encoding: 'utf8', windowsHide: true });
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'repository-artifacts-'));
  tempRoots.push(directory);
  git(directory, 'init', '--quiet');
  const fixturePolicy: RepositoryArtifactPolicy = {
    schemaVersion: 1,
    localOnlyDirectories: ['.agent-workbench/task-forest', 'runtime-research'],
    localOnlyFiles: ['scripts/local-probe.mjs'],
    retiredTests: ['tests/unit/retired-wording.test.ts'],
    requiredInputs: ['scripts/rc10/driver.mjs', 'plans/system-maturity/gates.json'],
    preservedMixedUseDirectories: ['artifacts'],
    artifactBatches: {},
  };
  write(directory, 'scripts/repository-artifacts.json', JSON.stringify(fixturePolicy));
  write(directory, '.gitignore', '/.agent-workbench/task-forest/\n/runtime-research/\n/scripts/local-probe.mjs\n');
  write(directory, 'package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
  for (const path of fixturePolicy.requiredInputs) write(directory, path);
  git(directory, 'add', '--all');
  return directory;
}

afterEach(() => {
  for (const directory of tempRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('repository artifact retention', () => {
  it('keeps the retention boundary narrower than mixed source directories', () => {
    for (const directory of ['artifacts', 'docs/dev', 'plans', 'tests', 'tests/unit', 'scripts', 'harness']) {
      expect(policy.localOnlyDirectories).not.toContain(directory);
    }
    expect(policy.retiredTests).toHaveLength(4);
    for (const path of policy.requiredInputs) expect(isLocalArtifact(path, policy), path).toBe(false);
    expect(isLocalArtifact('runtime-research-notes/fixture.json', policy)).toBe(false);
    expect(isLocalArtifact('.agent-workbench/task-forest-history/fixture.json', policy)).toBe(false);
  });

  it('ignores regenerated local history while keeping gate inputs addable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'repository-ignore-'));
    tempRoots.push(directory);
    git(directory, 'init', '--quiet');
    write(directory, '.gitignore', readFileSync(join(root, '.gitignore'), 'utf8'));
    const localPaths = [
      'artifacts/first-product-preview/FP-P2-01/evidence.md',
      'artifacts/first-product-preview/FP-P2-07/new-debug-report.json',
      'artifacts/first-product-preview/TF-0009/new-run.json',
      ...policy.localOnlyFiles,
      ...policy.localOnlyDirectories.map((path) => `${path}/generated.json`),
      ...Object.entries(policy.artifactBatches)
        .filter(([, status]) => status === 'local-only')
        .map(([batch]) => `artifacts/${batch}/generated.json`),
    ];
    for (const path of [...localPaths, ...policy.requiredInputs]) write(directory, path);
    const ignored = new Set(execFileSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
      cwd: directory,
      input: `${[...localPaths, ...policy.requiredInputs].join('\0')}\0`,
      encoding: 'utf8',
      windowsHide: true,
    }).split('\0').filter(Boolean));
    for (const path of localPaths) expect(ignored.has(path), path).toBe(true);
    for (const path of policy.requiredInputs) expect(ignored.has(path), path).toBe(false);
  });

  it('passes a checkout with no local task graph or retired wording tests', () => {
    expect(checkRepositoryArtifacts(createFixture()).issues).toEqual([]);
  });

  it('rejects ignored files that remain tracked and missing gate inputs', () => {
    const directory = createFixture();
    write(directory, '.agent-workbench/task-forest/graph/nodes.json', '{}');
    git(directory, 'add', '--force', '--', '.agent-workbench/task-forest/graph/nodes.json');
    rmSync(join(directory, 'plans/system-maturity/gates.json'));
    expect(checkRepositoryArtifacts(directory).issues).toEqual(expect.arrayContaining([
      'Local artifact is still tracked: .agent-workbench/task-forest/graph/nodes.json',
      'Required source input is missing: plans/system-maturity/gates.json',
    ]));
  });

  it('rejects a retired test still discoverable locally or required by a spec', () => {
    const directory = createFixture();
    const path = 'tests/unit/retired-wording.test.ts';
    write(directory, path);
    // Use the same Markdown frontmatter dialect as Harness, including unquoted prose.
    write(directory, 'harness/specs/tasks/history.md', `---\nid: history\nacceptance:\n  - Namespace: \`tool.choice\` stays bounded\nrequiredTests:\n  - pnpm exec vitest run ${path}\n---\n`);
    git(directory, 'add', '--', 'harness/specs/tasks/history.md');
    expect(checkRepositoryArtifacts(directory).issues).toEqual(expect.arrayContaining([
      `Retired test is still in default discovery: ${path}`,
      `Retired test remains an execution prerequisite: harness/specs/tasks/history.md: ${path}`,
    ]));
  });

  it('rejects a broad ignore that hides required gate inputs even if they remain tracked', () => {
    const directory = createFixture();
    write(directory, '.gitignore', '/plans/\n');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Required source input is ignored: plans/system-maturity/gates.json',
    );
  });

  it.each(['replay.log', 'replay with spaces 记录.log'])(
    'rejects ignored tracked output outside the old inventory: %s',
    (name) => {
      const directory = createFixture();
      write(directory, '.gitignore', '/scratch-output/\n');
      const path = `scratch-output/${name}`;
      write(directory, path);
      git(directory, 'add', '--force', '--', path);
      expect(checkRepositoryArtifacts(directory).issues).toContain(`Tracked path is ignored: ${path}`);
    },
  );

  it('rejects a new artifact batch until its retention status is declared', () => {
    const directory = createFixture();
    write(directory, 'artifacts/unreviewed-batch/report.json', '{}');
    git(directory, 'add', '--', 'artifacts/unreviewed-batch/report.json');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Artifact batch has no retention status: artifacts/unreviewed-batch',
    );
  });

  it.each(['retained', 'mixed'] as const)('accepts a declared %s batch that is not ignored', (status) => {
    const directory = createFixture();
    const fixturePolicy = JSON.parse(readFileSync(join(directory, 'scripts/repository-artifacts.json'), 'utf8'));
    fixturePolicy.artifactBatches = { fixture: status };
    write(directory, 'scripts/repository-artifacts.json', JSON.stringify(fixturePolicy));
    write(directory, 'artifacts/fixture/report.json', '{}');
    git(directory, 'add', '--', 'artifacts/fixture/report.json');
    expect(checkRepositoryArtifacts(directory).issues).toEqual([]);
  });

  it('rejects a tracked batch declared local-only even without a duplicate directory entry', () => {
    const directory = createFixture();
    const fixturePolicy = JSON.parse(readFileSync(join(directory, 'scripts/repository-artifacts.json'), 'utf8'));
    fixturePolicy.artifactBatches = { archive: 'local-only' };
    write(directory, 'scripts/repository-artifacts.json', JSON.stringify(fixturePolicy));
    write(directory, 'artifacts/archive/report.json', '{}');
    git(directory, 'add', '--', 'artifacts/archive/report.json');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Local-only artifact batch is still tracked: artifacts/archive/report.json',
    );
  });

  it('does not exempt ignored files in an explicitly retained batch', () => {
    const directory = createFixture();
    const fixturePolicy = JSON.parse(readFileSync(join(directory, 'scripts/repository-artifacts.json'), 'utf8'));
    fixturePolicy.artifactBatches = { fixture: 'retained' };
    write(directory, 'scripts/repository-artifacts.json', JSON.stringify(fixturePolicy));
    write(directory, '.gitignore', '/artifacts/fixture/\n');
    write(directory, 'artifacts/fixture/report.json', '{}');
    git(directory, 'add', '--force', '--', 'artifacts/fixture/report.json');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Tracked path is ignored: artifacts/fixture/report.json',
    );
  });

  it.each(['check.yml', 'harness.yml'])('runs the retention gate before install and Harness in %s', (workflow) => {
    const source = readFileSync(join(root, '.github/workflows', workflow), 'utf8');
    const gate = source.indexOf('run: node scripts/check-repository-artifacts.mjs');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(source.indexOf('run: pnpm install --frozen-lockfile'));
    expect(gate).toBeLessThan(source.indexOf('run: pnpm run harness:ci'));
  });

  it('rejects invalid retention status rather than treating it as an exemption', () => {
    const directory = createFixture();
    const fixturePolicy = JSON.parse(readFileSync(join(directory, 'scripts/repository-artifacts.json'), 'utf8'));
    fixturePolicy.artifactBatches = { fixture: 'approved-by-confidence' };
    write(directory, 'scripts/repository-artifacts.json', JSON.stringify(fixturePolicy));
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Invalid artifact batch retention status: fixture=approved-by-confidence',
    );
  });
});
