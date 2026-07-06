import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  calculateCompressionEvidenceRetentionRate,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';

const REQUIRED_REF = {
  resourceId: 'toolset:local.shell@v1',
  selector: 'schema:tool.run_shell.required',
  checksum: `sha256:${'e'.repeat(64)}`,
  kind: 'toolset' as const,
};

describe('context compression eval compatibility', () => {
  it('reports ERR at 100% when required CRK evidence refs survive compaction', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Retain CRK selector evidence.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [REQUIRED_REF],
        retrievedContext: [REQUIRED_REF],
        retrievalTrace: [{ ...REQUIRED_REF, reason: 'recovery' }],
      },
    });

    expect(calculateCompressionEvidenceRetentionRate(artifact)).toEqual({
      required: 1,
      retained: 1,
      rate: 1,
    });
  });

  it('makes evidence loss visible instead of masking it with token savings', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Expose missing selector evidence.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [REQUIRED_REF],
        retrievedContext: [],
        retrievalTrace: [],
      },
    });

    expect(calculateCompressionEvidenceRetentionRate(artifact)).toEqual({
      required: 1,
      retained: 0,
      rate: 0,
    });
  });
});
