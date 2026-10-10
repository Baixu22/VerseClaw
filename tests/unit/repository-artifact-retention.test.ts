// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepositoryArtifacts, isLocalArtifact, renderReviewedIgnore } from '../../scripts/check-repository-artifacts.mjs';
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
    // Reproduce the repository's real ignore topology, not only the root file: a
    // declared local-only path may be ignored by a nested .gitignore (for example
    // packages/vtoken/.tiktoken_cache is matched by packages/vtoken/.gitignore).
    // Copying the root file alone would misreport such a path as unignored and
    // would weaken the "declared local-only means ignored in fact" invariant.
    for (const ignoreFile of git(root, 'ls-files').split('\n').filter((file) => file.endsWith('.gitignore'))) {
      write(directory, ignoreFile, readFileSync(join(root, ignoreFile), 'utf8'));
    }
    const localPaths = [
      ...(policy.reviewedDirectories ?? []).map((path) => `${path}/unreviewed/run.log`),
      ...policy.localOnlyFiles,
      ...policy.localOnlyDirectories.map((path) => `${path}/generated.json`),
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

  it('rejects unreviewed forced additions, including new files inside a retained pack', () => {
    const directory = createFixture();
    const reviewed = {
      ...JSON.parse(readFileSync(join(directory, 'scripts/repository-artifacts.json'), 'utf8')),
      reviewedDirectories: ['artifacts', 'docs'],
      retainedFiles: ['artifacts/current/report.json'],
    };
    write(directory, 'artifacts/current/report.json', '{}');
    write(directory, 'scripts/repository-artifacts.json', JSON.stringify(reviewed));
    write(directory, '.gitignore', readFileSync(join(directory, '.gitignore'), 'utf8') + renderReviewedIgnore(reviewed) + '\n');
    git(directory, 'add', '--all');
    expect(checkRepositoryArtifacts(directory).passed).toBe(true);
    for (const path of ['artifacts/current/debug.log', 'artifacts/another-round/report.json', 'docs/audit-draft.md']) {
      write(directory, path);
      expect(git(directory, 'check-ignore', '--', path).trim()).toBe(path);
      git(directory, 'add', '--force', '--', path);
      expect(checkRepositoryArtifacts(directory).issues).toContain('Local artifact is still tracked: ' + path);
    }
  });

  it('rejects missing reviewed inputs and stale generated ignore rules', () => {
    const directory = createFixture();
    const reviewed = {
      ...JSON.parse(readFileSync(join(directory, 'scripts/repository-artifacts.json'), 'utf8')),
      reviewedDirectories: ['artifacts'], retainedFiles: ['artifacts/current/report.json'],
    };
    write(directory, 'scripts/repository-artifacts.json', JSON.stringify(reviewed));
    expect(checkRepositoryArtifacts(directory).issues).toEqual(expect.arrayContaining([
      'Reviewed input is not tracked: artifacts/current/report.json',
      'Reviewed input is missing: artifacts/current/report.json',
      'Reviewed ignore rules are stale: run pnpm repo:artifacts:check --write-ignore',
    ]));
  });

  it('rejects a task spec that requires private handoff history', () => {
    const directory = createFixture();
    write(directory, 'harness/specs/tasks/private-docs.md', '---\nid: private-docs\ndocs:\n  required: true\n  files:\n    - runtime-research/LATEST.md\n---\n');
    git(directory, 'add', '--', 'harness/specs/tasks/private-docs.md');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Spec requires local or missing documentation: harness/specs/tasks/private-docs.md: runtime-research/LATEST.md',
    );
  });

  it('runs the source boundary gate in PR CI before dependency installation', () => {
    const workflow = readFileSync(join(root, '.github/workflows/check.yml'), 'utf8');
    const gate = workflow.indexOf('run: node scripts/check-repository-artifacts.mjs');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(workflow.indexOf('run: pnpm install --frozen-lockfile'));
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

  it('rejects a tracked path that is also matched by .gitignore (shadow tracking)', () => {
    const directory = createFixture();
    write(directory, '.gitignore', '/scratch-output/');
    write(directory, 'scratch-output/replay.log', 'log');
    git(directory, 'add', '--force', '--', 'scratch-output/replay.log');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Tracked path is ignored: scratch-output/replay.log',
    );
  });

  it('rejects a broad ignore that hides required gate inputs even if they remain tracked', () => {
    const directory = createFixture();
    write(directory, '.gitignore', '/plans/\n');
    expect(checkRepositoryArtifacts(directory).issues).toContain(
      'Required source input is ignored: plans/system-maturity/gates.json',
    );
  });

  // Issue #97: the vtoken tokenizer cache is a machine-local generated file that
  // must never be committed. packages/vtoken/.gitignore is supposed to ignore
  // `packages/vtoken/.tiktoken_cache/`, but the pattern had been appended to the
  // tail of a comment line with no newline before it, so the whole line was a
  // comment and nothing ever matched. The file is valid UTF-8 throughout.
  // Two layers are needed: a valid ignore pattern, and no tracked path under it.
  it('keeps the vtoken tokenizer cache ignored in fact, not only in a comment', () => {
    const tokenizerCacheDirectory = 'packages/vtoken/.tiktoken_cache';
    const hashNamedCacheFile = '9b5ad71b2ce5302211f9c61530b329a4922fc6a4';
    const cacheRelativePath = `${tokenizerCacheDirectory}/${hashNamedCacheFile}`;

    // Layer 1: no tracked path under the cache directory. This is what actually
    // fails when the file is (re)committed, whatever the ignore file says.
    const tracked = git(root, 'ls-files', '--', tokenizerCacheDirectory).split('\n').filter(Boolean);
    expect(tracked).toEqual([]);

    // Layer 2: the pattern must match on its own line inside a real checkout.
    // A pattern that only appears behind a '#' comment yields no match, which is
    // exactly the regression this guards.
    const fixture = mkdtempSync(join(tmpdir(), 'vtoken-ignore-'));
    tempRoots.push(fixture);
    git(fixture, 'init', '--quiet');
    mkdirSync(join(fixture, dirname(cacheRelativePath)), { recursive: true });
    writeFileSync(join(fixture, cacheRelativePath), 'cache');
    mkdirSync(join(fixture, 'packages/vtoken'), { recursive: true });
    // Copy the real ignore file byte for byte so the assertion exercises the
    // shipped pattern rather than a restatement of it.
    writeFileSync(
      join(fixture, 'packages/vtoken/.gitignore'),
      readFileSync(join(root, 'packages/vtoken/.gitignore')),
    );
    const matched = execFileSync('git', ['check-ignore', '-v', '--no-index', '--', cacheRelativePath], {
      cwd: fixture,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    expect(matched).toContain('.tiktoken_cache/');
    expect(matched).toContain(cacheRelativePath);
  });
});
