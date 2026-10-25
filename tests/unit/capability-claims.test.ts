import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPABILITY_CLAIM_CLASSIFICATIONS,
  CAPABILITY_CLAIM_MATRIX,
  CAPABILITY_CLAIM_RUNTIME_STATUSES,
  findCapabilityClaim,
} from '@shared/capability-claims';
import { RELIABILITY_BOUNDARIES } from '@shared/reliability-boundaries';
import { analyzeCapabilityClaimText } from '../../scripts/check-capability-claims.mjs';

describe('capability claim matrix', () => {
  it('covers the 45 capability claims in report order', () => {
    expect(CAPABILITY_CLAIM_MATRIX).toHaveLength(45);
    expect(CAPABILITY_CLAIM_MATRIX.map((entry) => entry.id))
      .toEqual(Array.from({ length: 45 }, (_, index) => `capability-${String(index + 1).padStart(2, '0')}`));
  });

  it('requires every claim to carry the acceptance matrix fields', () => {
    for (const entry of CAPABILITY_CLAIM_MATRIX) {
      expect(entry.title.trim(), entry.id).not.toHaveLength(0);
      expect(entry.classification, entry.id).toSatisfy((value: string) =>
        CAPABILITY_CLAIM_CLASSIFICATIONS.includes(value as never));

      expect(entry.claim.safe.trim(), entry.id).not.toHaveLength(0);
      expect(entry.claim.unsafe.trim(), entry.id).not.toHaveLength(0);

      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
      for (const evidence of entry.evidence) {
        expect(evidence.level.trim(), entry.id).not.toHaveLength(0);
        expect(evidence.summary.trim(), entry.id).not.toHaveLength(0);
        expect(evidence.refs.length, entry.id).toBeGreaterThan(0);
      }

      expect(entry.userPath.surface.trim(), entry.id).not.toHaveLength(0);
      expect(entry.userPath.entrypoint.trim(), entry.id).not.toHaveLength(0);
      expect(entry.userPath.boundary.trim(), entry.id).not.toHaveLength(0);

      expect(entry.runtimeProof.status, entry.id).toSatisfy((value: string) =>
        CAPABILITY_CLAIM_RUNTIME_STATUSES.includes(value as never));
      expect(entry.runtimeProof.summary.trim(), entry.id).not.toHaveLength(0);
      expect(entry.runtimeProof.refs.length, entry.id).toBeGreaterThan(0);

      expect(entry.knownExclusions.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('pins high-risk overclaims to explicit exclusions', () => {
    expect(findCapabilityClaim('capability-07')).toMatchObject({
      classification: 'FP-OVERCLAIM',
      claim: {
        unsafe: expect.stringContaining('editable Chat DAG'),
      },
      knownExclusions: expect.arrayContaining([
        expect.stringContaining('Chat does not expose editable DAG'),
      ]),
    });
    expect(findCapabilityClaim('capability-41')).toMatchObject({
      classification: 'FP-OVERCLAIM',
      runtimeProof: {
        status: 'not-guaranteed',
      },
    });
  });

  it('keeps the generated machine-readable status table in sync', () => {
    const artifactPath = join(process.cwd(), 'artifacts', 'capability-claims', 'status-table.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      source: string;
      total: number;
      items: Array<{
        id: string;
        reportItem: number;
        classification: string;
        status: string;
        evidenceLevels: string[];
        lastVerifiedAt: string;
      }>;
    };

    expect(artifact.source).toBe('shared/capability-claims.ts');
    expect(artifact.total).toBe(45);
    expect(artifact.items.map((item) => item.id)).toEqual(CAPABILITY_CLAIM_MATRIX.map((entry) => entry.id));

    for (const entry of CAPABILITY_CLAIM_MATRIX) {
      const item = artifact.items.find((candidate) => candidate.id === entry.id);
      expect(item, entry.id).toBeDefined();
      expect(item).toMatchObject({
        reportItem: entry.reportItem,
        classification: entry.classification,
        status: entry.runtimeProof.status,
      });
      expect(item?.evidenceLevels).toEqual([...new Set(entry.evidence.map((evidence) => evidence.level))]);
      expect(item?.lastVerifiedAt).toBe(entry.runtimeProof.lastVerifiedAt ?? '2026-07-04');
    }
  });

  it('warns when high-confidence product claims lack evidence references', () => {
    const findings = analyzeCapabilityClaimText({
      filePath: 'docs/product-copy.md',
      text: 'Chat plan editing is implemented, productized, stable, and ready for all users.',
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'capability.high-confidence-without-evidence',
        severity: 'warning',
        filePath: 'docs/product-copy.md',
      }),
    ]);
  });

  it('allows high-confidence claims that cite matrix and runtime or E2E evidence', () => {
    const findings = analyzeCapabilityClaimText({
      filePath: 'docs/product-copy.md',
      text: [
        'The core Chat/Gateway path is stable for the scoped runtime validation.',
        'Evidence: TP-RUN, reports/real-runtime-task-validation-2026-07-04.md, tests/e2e/chat-work-mode.spec.ts.',
        'Boundary: see shared/capability-claims.ts and artifacts/capability-claims/status-table.json.',
      ].join('\n'),
    });

    expect(findings).toEqual([]);
  });

  it('warns when text repeats an unsafe overclaim from the matrix', () => {
    const findings = analyzeCapabilityClaimText({
      filePath: 'README.md',
      text: 'Chat exposes an editable Chat DAG with dependency editing.',
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'capability.unsafe-overclaim',
        severity: 'warning',
        claimId: 'capability-07',
      }),
    ]));
  });

  it('warns when text repeats a product-semantic unsafe claim', () => {
    const findings = analyzeCapabilityClaimText({
      filePath: 'docs/product-copy.md',
      text: [
        'Plan mode provides strict no-diff execution for every write.',
        'Routing Memo learns role quality by default.',
        'Ordinary team_orchestrate returns complete quality scoring.',
      ].join('\n'),
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'capability.product-semantic-unsafe-claim',
        severity: 'warning',
        filePath: 'docs/product-copy.md',
      }),
      expect.objectContaining({
        code: 'capability.product-semantic-unsafe-claim',
        severity: 'warning',
        filePath: 'docs/product-copy.md',
      }),
      expect.objectContaining({
        code: 'capability.product-semantic-unsafe-claim',
        severity: 'warning',
        filePath: 'docs/product-copy.md',
      }),
    ]);
  });

  it('links P2-06 reliability claims to the machine-readable boundary matrix', () => {
    const reliabilityRef = 'shared/reliability-boundaries.ts';
    const matrixSubsystems = new Set(RELIABILITY_BOUNDARIES.map((entry) => entry.subsystem));

    for (const claimId of ['capability-22', 'capability-26']) {
      const claim = findCapabilityClaim(claimId);
      expect(claim?.relatedTaskIds).toContain('P2-06');
      expect(claim?.evidence.some((item) => item.refs.includes(reliabilityRef)), claimId).toBe(true);
      expect(claim?.runtimeProof.refs).toContain(reliabilityRef);
    }

    expect(matrixSubsystems).toEqual(new Set([
      'gateway-startup',
      'provider-fallback',
      'host-api-api-client',
      'session-restore-replay',
      'file-writes',
      'dangerous-approvals',
      'task-loop-repair-retry',
    ]));
  });
});
