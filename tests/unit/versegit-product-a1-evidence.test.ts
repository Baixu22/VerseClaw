import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  candidateIdentity,
  documentDigest,
  findAbsolutePathLeaks,
  validateHistoricalIndex,
  validateNegativeChecks,
} from '../../scripts/versegit-product-a1-evidence.mjs';

function binary(overrides: Record<string, unknown> = {}) {
  return {
    role: 'provider-debug-sidecar',
    sha256: 'a'.repeat(64),
    bytes: 42,
    version: 'vg 0.1.0',
    capabilities: { schema: 'versegit.capabilities/v1' },
    capabilities_sha256: 'b'.repeat(64),
    ...overrides,
  };
}

function sign(document: Record<string, unknown>) {
  document.digest = documentDigest(document);
  return document;
}

function historicalFixture(root: string) {
  const artifact = 'evidence.json';
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, artifact), '{"old":true}\n', 'utf8');
  const content = '{"old":true}\n';
  const digest = createHash('sha256').update(content).digest('hex');
  const entry = (id: string, source_task: string, classification: string) => ({
    id,
    source_task,
    kind: 'historical-evidence',
    driven_by: 'agent',
    actor: 'codex',
    original_verdict: 'PASS',
    candidate: { candidate_id: null, commit: null, tree: null },
    artifacts: [{ path: artifact, sha256: digest, bytes: Buffer.byteLength(content) }],
    classification,
    verifier_issues: classification === 'historical-stale' ? ['stale input digest'] : [],
    current_candidate_reuse: false,
  });
  return sign({
    schema: 'clawx.versegit.product-a1-historical-index/v1',
    generated_at: '2026-10-22T00:00:00.000Z',
    task: 'TF-0524',
    driven_by: 'agent',
    actor: 'codex',
    current_candidate_id: 'c'.repeat(64),
    old_evidence_reused_as_current: false,
    same_candidate_as_current: false,
    entries: [
      entry('wp6-engineering-closeout', 'TF-0472', 'historical-stale'),
      entry('wp7-host-vertical-slice', 'TF-0513', 'historical-replayable-under-curated-evidence'),
      entry('wp8-independent-review', 'TF-0514', 'historical-stale'),
      entry('wp9-global-acceptance', 'TF-0515', 'historical-stale'),
    ],
  });
}

describe('VerseGit A1 current baseline evidence', () => {
  it('binds candidate identity to both source inputs and binary identity', () => {
    const inputs = [{ role: 'source', path: 'scripts/a.mjs', sha256: '1'.repeat(64), bytes: 10 }];
    const base = candidateIdentity(inputs, binary());
    expect(base).toMatch(/^[0-9a-f]{64}$/u);
    expect(candidateIdentity(structuredClone(inputs), binary())).toBe(base);
    const changedInputs = structuredClone(inputs);
    changedInputs[0].sha256 = '2'.repeat(64);
    expect(candidateIdentity(changedInputs, binary())).not.toBe(base);
    expect(candidateIdentity(inputs, binary({ sha256: 'd'.repeat(64) }))).not.toBe(base);
  });

  it('detects machine-absolute paths while allowing relative roles and paths', () => {
    expect(findAbsolutePathLeaks({ role: 'worktree-root', path: 'scripts/a.mjs' })).toEqual([]);
    expect(findAbsolutePathLeaks({ path: 'D:/ClawX/scripts/a.mjs' })).toEqual(['path']);
    expect(findAbsolutePathLeaks({ nested: ['C:\\Users\\owner\\secret'] })).toEqual(['nested[0]']);
  });

  it('keeps historical evidence historical and rejects promotion or byte drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'versegit-a1-history-'));
    try {
      const index = historicalFixture(root);
      expect(validateHistoricalIndex(index, { root }).issues).toEqual([]);
      const promoted = structuredClone(index);
      promoted.old_evidence_reused_as_current = true;
      sign(promoted);
      expect(validateHistoricalIndex(promoted, { root }).issues).toContain('historical evidence promoted as current');
      writeFileSync(join(root, 'evidence.json'), '{"old":false}\n', 'utf8');
      expect(validateHistoricalIndex(index, { root }).issues.some((issue: string) => issue.includes('historical artifact bytes changed'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires every tamper probe to fail closed', () => {
    const document = sign({
      schema: 'clawx.versegit.product-a1-negative-checks/v1',
      generated_at: '2026-10-22T00:00:00.000Z',
      task: 'TF-0524',
      driven_by: 'agent',
      actor: 'codex',
      status: 'passed',
      cases: ['input-byte-hash', 'candidate-id', 'historical-promotion', 'absolute-path'].map((id) => ({ id, rejected: true, issues: ['rejected'] })),
    });
    expect(validateNegativeChecks(document).issues).toEqual([]);
    const weakened = structuredClone(document);
    weakened.cases[0].rejected = false;
    sign(weakened);
    expect(validateNegativeChecks(weakened).issues).toContain('negative case missing or not rejected: input-byte-hash');
  });
});
