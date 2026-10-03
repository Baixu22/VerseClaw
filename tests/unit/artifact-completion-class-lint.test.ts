import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintArtifactCompletionClasses, runCli } from '../../scripts/lint-artifact-completion-class.mjs';

const temporaryRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawx-completion-class-'));
  temporaryRoots.push(root);
  return root;
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function humanEvidence(id = 'operator/alice'): object {
  return {
    actor: { kind: 'human', id },
    runs: 1,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('artifact completionClass lint', () => {
  it('checks ignored artifact JSON files by default', () => {
    const root = makeRoot();
    writeFileSync(join(root, '.gitignore'), 'artifacts/*\n', 'utf8');
    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['add', '.gitignore'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: root, stdio: 'pipe' });
    writeJson(root, 'artifacts/ignored/report.json', { completionClass: 'done (fixture)' });

    const errors: string[] = [];
    const exitCode = runCli(['--root', root, '--base-ref', 'HEAD'], {
      log: () => {},
      error: (message: unknown) => errors.push(String(message)),
    });

    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('requires positive human evidence');
  });

  it('ignores an unchanged historical done class', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/legacy/report.json';
    const document = { completionClass: 'done (hard)', evidenceLimits: { humanRuns: 0 } };
    writeJson(root, relativePath, document);

    const report = lintArtifactCompletionClasses({
      root,
      files: [relativePath],
      baselineDocuments: new Map([[relativePath, document]]),
    });

    expect(report.ok).toBe(true);
    expect(report.checked).toBe(0);
    expect(report.historicalEntriesIgnored).toBe(1);
  });

  it('fails a newly added done class without positive human evidence', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, {
      completionClass: 'done (constructed)',
      evidenceLimits: {
        humanRuns: 0,
        humanEvidence: { required: true },
        actor: { kind: 'agent', id: 'codex/root' },
      },
    });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toContain('requires positive human evidence');
  });

  it.each([
    ['missing human identity', { humanEvidence: { runs: 1 } }],
    ['missing positive observation', { humanEvidence: { actor: { kind: 'human', id: 'operator/alice' } } }],
    ['zero observation', { humanEvidence: { actor: { kind: 'human', id: 'operator/alice' }, runs: 0 } }],
    ['agent identity', { humanEvidence: { actor: { kind: 'agent', id: 'codex/root' }, runs: 1 } }],
    ['synthetic identity', { humanEvidence: { actor: { kind: 'synthetic', id: 'run-1' }, runs: 1 } }],
    ['placeholder identity', { humanEvidence: { actor: { kind: 'human', id: 'placeholder' }, runs: 1 } }],
  ])('rejects done with %s', (_reason, evidence) => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, { completionClass: 'done (human-canary)', ...evidence });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toContain('requires positive human evidence');
  });

  it('accepts done with structured human identity and a positive observation', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, {
      artifactId: 'artifact-1',
      completionClass: 'done (human-canary)',
      humanEvidence: humanEvidence(),
    });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(true);
    expect(report.checked).toBe(1);
  });

  it('allows verified-engineering without human evidence', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, {
      completionClass: 'verified-engineering (synthetic)',
      live: false,
    });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(true);
    expect(report.checked).toBe(1);
  });

  it.each(['artifactId', 'runId', 'taskId'])('accepts sibling evidence bound by %s', (identityKey) => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, {
      [identityKey]: 'identity-1',
      completionClass: 'done (human-canary)',
    });
    writeJson(root, 'artifacts/new/human-evidence.json', {
      [identityKey]: 'identity-1',
      humanEvidence: humanEvidence(),
    });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(true);
    expect(report.checked).toBe(1);
  });

  it('rejects positive sibling evidence without identity binding', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, {
      artifactId: 'artifact-1',
      completionClass: 'done (human-canary)',
    });
    writeJson(root, 'artifacts/new/human-evidence.json', {
      humanEvidence: humanEvidence(),
    });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(false);
  });

  it('rejects positive sibling evidence bound to a different artifact', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/report.json';
    writeJson(root, relativePath, {
      artifactId: 'artifact-1',
      runId: 'run-1',
      taskId: 'task-1',
      completionClass: 'done (human-canary)',
    });
    writeJson(root, 'artifacts/new/human-evidence.json', {
      artifactId: 'artifact-2',
      runId: 'run-2',
      taskId: 'task-2',
      humanEvidence: humanEvidence(),
    });

    const report = lintArtifactCompletionClasses({ root, files: [relativePath] });

    expect(report.ok).toBe(false);
  });

  it('ignores array reordering when stable IDs and completion classes are unchanged', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/reports.json';
    const baseline = {
      reports: [
        { artifactId: 'artifact-a', completionClass: 'verified-engineering (baseline)' },
        { artifactId: 'artifact-b', completionClass: 'verified-engineering (baseline)' },
      ],
    };
    writeJson(root, relativePath, {
      reports: [...baseline.reports].reverse(),
    });

    const report = lintArtifactCompletionClasses({
      root,
      files: [relativePath],
      baselineDocuments: new Map([[relativePath, baseline]]),
    });

    expect(report.ok).toBe(true);
    expect(report.checked).toBe(0);
    expect(report.historicalEntriesIgnored).toBe(2);
  });

  it('checks a changed completion class on the same stable ID after reordering', () => {
    const root = makeRoot();
    const relativePath = 'artifacts/new/reports.json';
    const baseline = {
      reports: [
        { artifactId: 'artifact-a', completionClass: 'verified-engineering (baseline)' },
        { artifactId: 'artifact-b', completionClass: 'verified-engineering (baseline)' },
      ],
    };
    writeJson(root, relativePath, {
      reports: [
        { artifactId: 'artifact-b', completionClass: 'verified-engineering (baseline)' },
        { artifactId: 'artifact-a', completionClass: 'done (human-canary)' },
      ],
    });

    const report = lintArtifactCompletionClasses({
      root,
      files: [relativePath],
      baselineDocuments: new Map([[relativePath, baseline]]),
    });

    expect(report.ok).toBe(false);
    expect(report.checked).toBe(1);
    expect(report.historicalEntriesIgnored).toBe(1);
  });

  it('keeps the L3 definition and default locks together in STATUS', () => {
    const status = readFileSync(join(process.cwd(), 'docs/dev/dcs-visible-production/STATUS.md'), 'utf8');
    expect(status).toContain('L3 = 1 名真人 × 1 个表面 × 14 天 × 可回滚');
    expect(status).toContain('human-corpus + live-ab + soak + product-approval');
    expect(status).toContain('verified-engineering(...)');
    expect(status).toContain('defaultOn=false');
  });
});
