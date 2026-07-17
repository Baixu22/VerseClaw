import { describe, expect, it } from 'vitest';

import {
  SENSITIVE_CONTENT_BOUNDARY_MATRIX,
  findSensitiveContentBoundary,
} from '@shared/sensitive-content-boundary';
import { findCapabilityClaim } from '@shared/capability-claims';

describe('sensitive content boundary matrix', () => {
  it('verifies transcript fake-key redaction is a configurable local persistence policy', async () => {
    const { redactTranscriptMessage } = await import('../../openclaw_runtime/src/agents/transcript-redact');
    const secret = 'OPENAI_API_KEY=sk-test1234567890ABCDE';
    const message = {
      role: 'user',
      content: `please remember ${secret}`,
    };

    const redacted = redactTranscriptMessage(message as never);
    const redactedJson = JSON.stringify(redacted);
    expect(redactedJson).not.toContain(secret);
    expect(redactedJson).toContain('OPENAI_API_KEY=');

    const disabled = redactTranscriptMessage(message as never, {
      logging: { redactSensitive: 'off' },
    } as never);
    expect(JSON.stringify(disabled)).toContain(secret);
  });

  it('documents every high-risk surface without claiming a full-chain secret-free guarantee', () => {
    expect(SENSITIVE_CONTENT_BOUNDARY_MATRIX.map((entry) => entry.surface)).toEqual([
      'file',
      'transcript',
      'trace',
      'memory',
      'compaction',
      'sekb',
      'modelEcho',
    ]);

    for (const entry of SENSITIVE_CONTENT_BOUNDARY_MATRIX) {
      expect(entry.safeClaim.trim(), entry.surface).not.toHaveLength(0);
      expect(entry.noGuarantee.trim(), entry.surface).not.toHaveLength(0);
      expect(entry.evidenceRefs.length, entry.surface).toBeGreaterThan(0);
      expect(entry.relatedTaskIds, entry.surface).toContain('P1-14');
      expect(entry.fullPlaintextFreeGuarantee, entry.surface).toBe(false);
    }
  });

  it('keeps transcript redaction scoped to local policy evidence, not real chat E2E proof', () => {
    const transcript = findSensitiveContentBoundary('transcript');

    expect(transcript).toMatchObject({
      surface: 'transcript',
      guaranteeLevel: 'local-policy',
      fullPlaintextFreeGuarantee: false,
      relatedTaskIds: expect.arrayContaining(['P1-10', 'P1-14']),
    });
    expect(transcript?.safeClaim).toContain('redactTranscriptMessage');
    expect(transcript?.noGuarantee).toContain('鐪熷疄 chat 娉ㄥ叆 E2E');
    expect(transcript?.evidenceRefs).toEqual(expect.arrayContaining([
      'openclaw_runtime/src/agents/transcript-redact.ts',
      'openclaw_runtime/src/config/sessions/transcript-append.ts',
      'tests/unit/sensitive-content-boundary.test.ts',
    ]));
  });

  it('records the memory.propose fake-key boundary as Gateway handler evidence', () => {
    const memory = findSensitiveContentBoundary('memory');

    expect(memory).toMatchObject({
      surface: 'memory',
      guaranteeLevel: 'local-rejection',
      fullPlaintextFreeGuarantee: false,
      relatedTaskIds: expect.arrayContaining(['P1-13', 'P1-14']),
    });
    expect(memory?.safeClaim).toContain('memory.propose Gateway handler');
    expect(memory?.noGuarantee).toContain('not a full Electron UI or WebSocket E2E');
    expect(memory?.evidenceRefs).toEqual(expect.arrayContaining([
      'openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts',
      'tests/unit/role-orchestration-methods.test.ts',
    ]));
  });

  it('records patch/diff projection and compaction projection P1 evidence', () => {
    const file = findSensitiveContentBoundary('file');
    const compaction = findSensitiveContentBoundary('compaction');

    expect(file).toMatchObject({
      surface: 'file',
      guaranteeLevel: 'raw-no-redaction',
      fullPlaintextFreeGuarantee: false,
      relatedTaskIds: expect.arrayContaining(['P1-11', 'P1-14']),
    });
    expect(file?.safeClaim).toContain('code-review runtime prompts');
    expect(file?.noGuarantee).toContain('raw Git diffs');
    expect(file?.evidenceRefs).toEqual(expect.arrayContaining([
      'electron/services/code-review-api.ts',
      'tests/unit/code-review-center.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ]));

    expect(compaction).toMatchObject({
      surface: 'compaction',
      guaranteeLevel: 'redacted-projection',
      fullPlaintextFreeGuarantee: false,
      relatedTaskIds: expect.arrayContaining(['P1-12', 'P1-14']),
    });
    expect(compaction?.safeClaim).toContain('Compaction artifact');
    expect(compaction?.noGuarantee).toContain('provider-generated summaries');
    expect(compaction?.evidenceRefs).toEqual(expect.arrayContaining([
      'openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts',
      'tests/unit/compression-artifact.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ]));
  });

  it('connects capability claims 40 and 41 to the documented boundary matrix', () => {
    const localProtection = findCapabilityClaim('capability-40');
    const fullChainOverclaim = findCapabilityClaim('capability-41');

    expect(localProtection?.evidence.some((item) =>
      item.refs.includes('shared/sensitive-content-boundary.ts'))).toBe(true);
    expect(fullChainOverclaim?.evidence.some((item) =>
      item.refs.includes('shared/sensitive-content-boundary.ts'))).toBe(true);
    expect(fullChainOverclaim?.knownExclusions).toEqual(expect.arrayContaining([
      expect.stringContaining('file'),
      expect.stringContaining('transcript'),
      expect.stringContaining('model echo'),
    ]));
  });
});
