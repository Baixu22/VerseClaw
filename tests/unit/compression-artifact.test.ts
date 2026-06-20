import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  normalizeCompressionArtifact,
  renderCompressionArtifactSummary,
  renderRecoveryContextProjection,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';

describe('compression artifact', () => {
  it('builds a dense recovery artifact with evidence and legacy summary rendering', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [
        { role: 'user', content: 'Implement token-dense recovery compression.' },
        { role: 'assistant', content: 'Updated src/pages/Chat/ChatInput.tsx and ran pnpm run typecheck.' },
      ] as never,
      summary: [
        '## Goal',
        'Ship high precision compaction.',
        '## Key Decisions',
        '- Use deterministic extraction before model synthesis.',
        '## Next Steps',
        '1. Run targeted tests.',
      ].join('\n'),
      readFiles: ['src/pages/Chat/ChatInput.tsx'],
      modifiedFiles: ['shared/host-api/contract.ts'],
      targetArtifactTokens: 1200,
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.objective).toContain('Ship high precision compaction');
    expect(artifact.filesTouched.map((item) => item.text)).toContain('shared/host-api/contract.ts');
    expect(artifact.testsRun.some((item) => item.text.includes('pnpm run typecheck'))).toBe(true);
    expect(artifact.quality.fieldCoverage).toBeGreaterThan(0.5);

    const summary = renderCompressionArtifactSummary(artifact);
    expect(summary).toContain('## Goal');
    expect(summary).toContain('## Critical Context');
  });

  it('renders recovery projection inside a small token budget', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [
        { role: 'user', content: 'Continue a long task.' },
        { role: 'assistant', content: 'Implemented many details. '.repeat(200) },
      ] as never,
      modifiedFiles: ['openclaw_runtime/src/gateway/server-methods/sessions.ts'],
    });

    const projection = renderRecoveryContextProjection(artifact, 220);

    expect(projection).toContain('Recovery Context Projection');
    expect(projection.length).toBeLessThanOrEqual(900);
  });

  it('normalizes stored artifacts and rejects non-v1 payloads', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Preserve decisions.' }] as never,
    });

    expect(normalizeCompressionArtifact({ schemaVersion: 2 })).toBeUndefined();
    expect(normalizeCompressionArtifact({
      ...artifact,
      evidenceRefs: [{ type: 'unexpected', ref: 'entry-1' }],
    })?.evidenceRefs[0]?.type).toBe('other');
  });
});
