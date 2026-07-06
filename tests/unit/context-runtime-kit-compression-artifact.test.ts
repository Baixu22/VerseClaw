import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  calculateCompressionEvidenceRetentionRate,
  normalizeCompressionArtifact,
  renderRecoveryContextProjection,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';

const VALID_CHECKSUM = `sha256:${'c'.repeat(64)}`;
const TOOL_REQUIRED_REF = {
  resourceId: 'toolset:local.shell@v1',
  selector: 'schema:tool.run_shell.required',
  checksum: VALID_CHECKSUM,
  kind: 'toolset' as const,
  label: 'shell required fields',
};

describe('Context Runtime Kit CompressionArtifact integration', () => {
  it('keeps old v1 artifacts valid when CRK fields are absent', () => {
    const oldArtifact = {
      schemaVersion: 1,
      objective: 'Continue from old compact state.',
      constraints: [],
      currentState: 'Old artifact has no CRK fields.',
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      filesTouched: [],
      testsRun: [],
      failedAttempts: [],
      deviations: [],
      nextAction: 'Continue.',
      reviewNeeded: [],
      evidenceRefs: [],
      unverifiedClaims: [],
      quality: {
        score: 1,
        level: 'high',
        fieldCoverage: 1,
        evidenceCoverage: 1,
        artifactTokens: 1,
        projectionTokens: 1,
        warnings: [],
      },
    };

    const normalized = normalizeCompressionArtifact(oldArtifact);

    expect(normalized).toBeDefined();
    expect(normalized?.retrievedContext).toBeUndefined();
    expect(normalized?.requiredSelectors).toBeUndefined();
    expect(normalized?.retrievalTrace).toBeUndefined();
  });

  it('preserves CRK evidence refs, required selectors, traces, uncertainty, blockers, and failed attempts in projection', () => {
    const largeDurableFact = 'RAW_TOOL_SCHEMA '.repeat(500);
    const artifact = buildDeterministicCompressionArtifact({
      messages: [
        { role: 'user', content: 'Use CRK refs during recovery.' },
        { role: 'assistant', content: 'Failed attempt: ran shell without selector evidence and failed validation.' },
      ] as never,
      summary: [
        '## Goal',
        '- Preserve selector evidence.',
        '### Blocked',
        '- Need checksum-backed selector before hard claim.',
      ].join('\n'),
      contextRuntimeKit: {
        retrievedContext: [TOOL_REQUIRED_REF],
        requiredSelectors: [TOOL_REQUIRED_REF],
        retrievalTrace: [{
          resourceId: TOOL_REQUIRED_REF.resourceId,
          selector: TOOL_REQUIRED_REF.selector,
          checksum: TOOL_REQUIRED_REF.checksum,
          reason: 'hard_claim',
          tokenCount: 12,
        }],
        capabilityActivations: [{
          kind: 'tool',
          name: 'run_shell',
          resourceId: TOOL_REQUIRED_REF.resourceId,
        }],
        unverifiedClaims: ['Shell required fields are available only after selector verification.'],
        staleReferences: [{ ...TOOL_REQUIRED_REF, checksum: `sha256:${'d'.repeat(64)}` }],
        largeDurableFacts: [{
          evidenceRef: TOOL_REQUIRED_REF,
          text: largeDurableFact,
        }],
      },
    });

    const projection = renderRecoveryContextProjection(artifact, 1200);
    const retention = calculateCompressionEvidenceRetentionRate(artifact);

    expect(artifact.retrievedContext).toEqual([TOOL_REQUIRED_REF]);
    expect(artifact.requiredSelectors).toEqual([TOOL_REQUIRED_REF]);
    expect(artifact.retrievalTrace?.[0]).toMatchObject({
      resourceId: TOOL_REQUIRED_REF.resourceId,
      selector: TOOL_REQUIRED_REF.selector,
      reason: 'hard_claim',
    });
    expect(retention).toEqual({ required: 1, retained: 1, rate: 1 });
    expect(projection).toContain('requiredSelectors');
    expect(projection).toContain('schema:tool.run_shell.required');
    expect(projection).toContain('unverifiedClaims');
    expect(projection).toContain('Shell required fields are available only after selector verification.');
    expect(projection).toContain('failedAttempts');
    expect(projection).toContain('blocked');
    expect(projection).toContain('staleReferences');
    expect(projection).not.toContain(largeDurableFact);
  });
});
