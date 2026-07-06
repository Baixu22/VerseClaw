import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  normalizeCompressionArtifact,
  renderCompressionArtifactSummary,
  renderRecoveryContextProjection,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import { compact } from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction';
import {
  defaultTokenPruningAdapter,
  microCompactText,
  planCompression,
  selectCompressionPlan,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner';
import { createFileOps } from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/utils';

describe('compression artifact', () => {
  it('stores an evidence-backed recovery artifact in compact details', async () => {
    const fileOps = createFileOps();
    fileOps.read.add('src/pages/Chat/index.tsx');
    fileOps.edited.add('shared/host-api/contract.ts');

    const result = await compact(
      {
        firstKeptEntryId: 'entry-kept',
        messagesToSummarize: [
          { id: 'user-1', role: 'user', content: 'Objective: preserve recovery facts during compaction.' },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Implemented contract changes and ran pnpm run typecheck, which failed once because stale data was missing.',
          },
        ] as never,
        turnPrefixMessages: [],
        isSplitTurn: false,
        tokensBefore: 900,
        fileOps,
        settings: { enabled: true, reserveTokens: 200, keepRecentTokens: 800, contextWindow: 1000 },
        staleExcludedCount: 2,
      },
      {
        id: 'test-model',
        name: 'Test Model',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'http://localhost',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000,
        maxTokens: 1000,
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => ({
        result: async () => ({
          role: 'assistant',
          content: [{
            type: 'text',
            text: [
              '## Goal',
              'Preserve recovery facts during compaction.',
              '## Key Decisions',
              '- Store deterministic compression artifacts with checkpoints.',
              '## Tests',
              '- pnpm run typecheck failed once because stale data was missing.',
              '## Next Actions',
              '1. Re-run targeted compression tests.',
            ].join('\n'),
          }],
          timestamp: Date.now(),
        }),
      }) as never,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.details?.artifact).toMatchObject({
      schemaVersion: 1,
      objective: expect.stringContaining('Preserve recovery facts'),
      staleExcludedCount: 2,
    });
    expect(result.value.details?.artifact?.evidenceRefs.length).toBeGreaterThan(0);
    expect(result.value.details?.artifact?.filesTouched.map((item) => item.text)).toContain('shared/host-api/contract.ts');
    expect(result.value.details?.artifact?.testsRun.some((item) => item.text.includes('pnpm run typecheck'))).toBe(true);
  });

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

  it('preserves telemetry fields through artifact normalization and recovery projection', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Continue with handoff telemetry.' }] as never,
      telemetry: {
        tier: 'tier3',
        strategy: 'semantic-handoff',
        compressionRatio: 0.24,
        tokensBefore: 1000,
        tokensAfter: 240,
        rehydratedFiles: ['src/pages/Chat/index.tsx'],
        staleExcludedCount: 2,
        causalAnchorCount: 5,
        warnings: ['low_evidence_coverage'],
      },
      rehydratedFileContext: [{
        path: 'src/pages/Chat/index.tsx',
        reason: 'next_action',
        lineStart: 12,
        lineEnd: 24,
        excerptHash: 'sha256:fixture',
        evidenceRefs: [{ type: 'file', ref: 'src/pages/Chat/index.tsx' }],
      }],
    });

    const normalized = normalizeCompressionArtifact(artifact);
    expect(normalized).toMatchObject({
      tier: 'tier3',
      strategy: 'semantic-handoff',
      compressionRatio: 0.24,
      tokensBefore: 1000,
      tokensAfter: 240,
      staleExcludedCount: 2,
      causalAnchorCount: 5,
    });
    expect(normalized?.quality.warnings).toContain('low_evidence_coverage');
    expect(renderRecoveryContextProjection(artifact)).toContain('compression: tier3 / semantic-handoff');
    expect(renderRecoveryContextProjection(artifact)).toContain('src/pages/Chat/index.tsx:12-24');
    expect(renderRecoveryContextProjection(artifact)).toContain('hash=sha256:fixture');
  });

  it('redacts secret-like content from compression artifacts and recovery projections', () => {
    const fakeKey = 'OPENAI_API_KEY=sk-test1234567890ABCDE';
    const artifact = buildDeterministicCompressionArtifact({
      messages: [
        { id: 'user-secret', role: 'user', content: `Continue work. Never preserve this fake key: ${fakeKey}` },
        { id: 'assistant-secret', role: 'assistant', content: `Implemented safeguard because ${fakeKey} appeared in context.` },
      ] as never,
      summary: [
        '## Goal',
        `Complete P1 without carrying ${fakeKey} into recovery summaries.`,
        '## Key Decisions',
        `- Treat ${fakeKey} as secret-like content and keep only a redacted projection.`,
        '## Next Steps',
        `1. Verify the compacted artifact does not echo ${fakeKey}.`,
      ].join('\n'),
      modifiedFiles: ['openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts'],
    });

    const serializedArtifact = JSON.stringify(artifact);
    const renderedSummary = renderCompressionArtifactSummary(artifact);
    const projection = renderRecoveryContextProjection(artifact);

    expect(serializedArtifact).not.toContain(fakeKey);
    expect(renderedSummary).not.toContain(fakeKey);
    expect(projection).not.toContain(fakeKey);
    expect(serializedArtifact).toContain('OPENAI_API_KEY');
    expect(projection).toContain('Recovery Context Projection');
  });

  it('selects progressive compression tiers by pressure', () => {
    const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 900, contextWindow: 1000 };

    expect(selectCompressionPlan({ tokensBefore: 500, settings }).tier).toBe('tier0');
    expect(selectCompressionPlan({ tokensBefore: 650, settings }).tier).toBe('tier1');
    expect(selectCompressionPlan({ tokensBefore: 800, settings }).tier).toBe('tier2');
    expect(selectCompressionPlan({ tokensBefore: 900, settings }).tier).toBe('tier3');
    expect(selectCompressionPlan({ tokensBefore: 980, settings }).tier).toBe('tier4');
  });

  it('micro-compacts long tool output and protects causal anchors during pruning', () => {
    const longText = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n');
    expect(microCompactText(longText)).toContain('micro-compacted');

    const result = planCompression({
      tokensBefore: 800,
      settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 900, contextWindow: 1000 },
      staleExcludedCount: 3,
      readFiles: ['src/a.ts'],
      modifiedFiles: ['src/b.ts'],
      messages: [
        {
          role: 'user',
          content: `We tried the old path but it failed because renderer boundary constraints forced a switch. ${'neutral '.repeat(200)}`,
        },
        { role: 'assistant', content: 'Older assistant context.' },
        { role: 'user', content: 'Older user context.' },
        { role: 'assistant', content: 'Middle assistant context.' },
        { role: 'user', content: 'Recent user context.' },
        { role: 'assistant', content: 'Latest hot context stays available.' },
      ] as never,
    });

    expect(result.plan.tier).toBe('tier2');
    expect(result.telemetry.causalAnchorCount).toBeGreaterThan(0);
    expect(result.telemetry.staleExcludedCount).toBe(3);
    expect(result.telemetry.rehydratedFiles).toEqual(['src/b.ts', 'src/a.ts']);
    expect(JSON.stringify(result.messages)).toContain('failed');
  });

  it('micro-compacts tool output, file bodies, and stack traces by content type', () => {
    const toolOutput = [
      '$ pnpm run typecheck',
      'exit code: 1',
      ...Array.from({ length: 70 }, (_, index) => (
        index === 33 ? 'src/a.ts(1,1): error TS2322: failed type assignment' : `neutral output ${index}`
      )),
    ].join('\n');
    const compactedTool = microCompactText(toolOutput);
    expect(compactedTool).toContain('command: pnpm run typecheck');
    expect(compactedTool).toContain('exit: exit code: 1');
    expect(compactedTool).toContain('error summary');
    expect(compactedTool).toContain('tool output lines micro-compacted');

    const fileBody = [
      'src/example.ts',
      ...Array.from({ length: 90 }, (_, index) => (
        index === 50 ? 'export function importantDecision() { return "because constraint"; }' : `const value${index} = ${index};`
      )),
    ].join('\n');
    const compactedFile = microCompactText(fileBody);
    expect(compactedFile).toContain('src/example.ts');
    expect(compactedFile).toContain('importantDecision');
    expect(compactedFile).toContain('file body lines omitted');

    const stackTrace = [
      'Error: failed because renderer boundary',
      ...Array.from({ length: 20 }, (_, index) => `    at frame${index} (src/file${index}.ts:1:1)`),
    ].join('\n');
    const compactedStack = microCompactText(stackTrace);
    expect(compactedStack).toContain('failed because renderer boundary');
    expect(compactedStack).toContain('repeated stack frames omitted');
  });

  it('preserves Chinese causal anchors with the deterministic token pruning fallback', () => {
    const text = [
      '前置背景 '.repeat(120),
      '尝试旧方案失败因为渲染器边界约束导致错误所以决定切换到host-api路径',
      '后续背景 '.repeat(120),
    ].join(' ');

    const result = defaultTokenPruningAdapter({
      text,
      targetRatio: 0.2,
      causalAnchors: ['失败', '因为', '约束', '决定', '切换'],
    });

    expect(result.causalAnchorCount).toBeGreaterThan(0);
    expect(result.text).toContain('失败因为渲染器边界约束导致错误所以决定切换');
  });

  it('keeps objective, next action, and recent hot context during emergency collapse', () => {
    const result = planCompression({
      tokensBefore: 980,
      settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 900, contextWindow: 1000 },
      messages: [
        { role: 'user', content: 'Objective: implement context compression without losing constraints.' },
        ...Array.from({ length: 8 }, (_, index) => ({ role: 'assistant', content: `older neutral message ${index}` })),
        { role: 'assistant', content: 'Next action: run DeepSeek continuation validation.' },
        { role: 'user', content: 'recent hot 1' },
        { role: 'assistant', content: 'recent hot 2' },
        { role: 'user', content: 'recent hot 3' },
        { role: 'assistant', content: 'recent hot 4' },
      ] as never,
    });

    const serialized = JSON.stringify(result.messages);
    expect(result.plan.tier).toBe('tier4');
    expect(result.telemetry.warnings).toContain('emergency_collapse_retained_objective_next_action_and_recent_tail');
    expect(serialized).toContain('Objective: implement context compression');
    expect(serialized).toContain('Next action: run DeepSeek continuation validation');
    expect(serialized).toContain('recent hot 4');
  });
});
