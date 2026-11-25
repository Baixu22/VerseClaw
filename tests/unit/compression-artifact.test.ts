import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  normalizeCompressionArtifact,
  renderCompressionArtifactSummary,
  renderRecoveryContextProjection,
  type CompressionArtifact,
  type CompressionSemanticAtom,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import { compact, prepareCompaction } from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction';
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
    const artifact = (result.value.details as { artifact?: CompressionArtifact } | undefined)?.artifact;
    if (!artifact) throw new Error('Expected compression artifact');
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      objective: expect.stringContaining('Preserve recovery facts'),
      telemetry: expect.objectContaining({ staleExcludedCount: 2 }),
    });
    expect(artifact.evidenceRefs.length).toBeGreaterThan(0);
    expect(artifact.filesTouched.map((item) => item.text)).toContain('shared/host-api/contract.ts');
    expect(artifact.testsRun.some((item) => item.text.includes('pnpm run typecheck'))).toBe(true);
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
      telemetry: {
        tier: 'tier3',
        strategy: 'semantic-handoff',
        compressionRatio: 0.24,
        tokensBefore: 1000,
        tokensAfter: 240,
        staleExcludedCount: 2,
        causalAnchorCount: 5,
      },
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

  it('keeps legacy v1 artifacts readable when semanticAtoms is absent', () => {
    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Legacy v1 artifact with no atom ledger.' }] as never,
    });
    const legacyPayload = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    delete legacyPayload.semanticAtoms;

    const normalized = normalizeCompressionArtifact(legacyPayload);

    expect(normalized).toBeDefined();
    expect(normalized?.schemaVersion).toBe(1);
    expect(normalized?.semanticAtoms).toBeUndefined();
    expect(normalized?.objective).toBe(artifact.objective);
  });

  it('normalizes semantic atoms, derives legacy fields from the ledger, and keeps atom text bounded', () => {
    const largeCodeTail = 'const durableBody = "' + 'z'.repeat(700) + '";';
    const largeCode = '```ts\n' + largeCodeTail + '\n```';
    const fakeSecret = 'sk-abcdefgh12345678';
    const atoms = [
      {
        id: 'atom-goal-a',
        type: 'goal',
        canonicalIdentity: 'goal:ship-semantic-atoms',
        severity: 'critical',
        confidence: 0.97,
        scope: 'session',
        polarity: 'positive',
        status: 'verified',
        text: `Ship the P1 semantic atom ledger without carrying OPENAI_API_KEY=${fakeSecret}.`,
        evidenceRefs: [{ type: 'session', ref: 'message:1', label: 'user message' }],
      },
      {
        id: 'atom-decision-a',
        type: 'decision',
        canonicalIdentity: 'decision:ledger-is-carrier',
        severity: 'important',
        confidence: 0.9,
        scope: 'task',
        polarity: 'neutral',
        status: 'verified',
        text: 'Use the atom ledger as the artifact carrier and keep Markdown as projection only.',
        evidenceRefs: [{ type: 'trace', ref: 'trace:1' }],
      },
      {
        id: 'atom-failed-a',
        type: 'failed_attempt',
        canonicalIdentity: 'failed:summary-only-extraction',
        severity: 'important',
        confidence: 0.95,
        scope: 'task',
        polarity: 'negative',
        status: 'verified',
        text: 'Summary-only extraction dropped evidence refs.',
        evidenceRefs: [{ type: 'session', ref: 'message:2' }],
      },
      {
        id: 'atom-next-a',
        type: 'next_action',
        canonicalIdentity: 'next:run-regressions',
        severity: 'important',
        confidence: 0.9,
        scope: 'task',
        polarity: 'positive',
        status: 'verified',
        text: 'Run the CRK recovery regression tests.',
        evidenceRefs: [{ type: 'session', ref: 'message:3' }],
      },
      {
        id: 'atom-body-a',
        type: 'entity',
        canonicalIdentity: 'entity:durable-body',
        severity: 'nice_to_have',
        confidence: 0.8,
        scope: 'workspace',
        polarity: 'neutral',
        status: 'verified',
        text: largeCode,
        evidenceRefs: [{ type: 'file', ref: 'src/durable.ts' }],
      },
      {
        id: 'atom-goal-unverified',
        type: 'goal',
        canonicalIdentity: 'goal:unverified-claim',
        severity: 'critical',
        confidence: 0.88,
        scope: 'session',
        polarity: 'positive',
        status: 'verified',
        text: 'A critical atom that has no evidence ref.',
        evidenceRefs: [],
      },
    ];

    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Implement atom-ledger compaction.' }] as never,
      semanticAtoms: atoms as CompressionSemanticAtom[],
    });

    const ledger = artifact.semanticAtoms ?? [];
    const criticalNoEvidence = ledger.find((atom) => atom.id === 'atom-goal-unverified');
    const boundedBody = ledger.find((atom) => atom.id === 'atom-body-a');

    expect(criticalNoEvidence?.status).toBe('unverified');
    expect(artifact.quality.warnings).toContain('critical_atom_missing_evidence');
    expect(artifact.objective).toContain('Ship the P1 semantic atom ledger');
    expect(artifact.objective).not.toContain(fakeSecret);
    expect(artifact.objective).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(artifact.decisions.map((item) => item.text)).toContain(
      'Use the atom ledger as the artifact carrier and keep Markdown as projection only.',
    );
    expect(artifact.failedAttempts.map((item) => item.text)).toContain(
      'Summary-only extraction dropped evidence refs.',
    );
    expect(artifact.nextAction).toBe('Run the CRK recovery regression tests.');
    expect(boundedBody?.text).not.toContain(largeCodeTail);
    expect(boundedBody?.text.length).toBeLessThanOrEqual(260);

    const projection = renderRecoveryContextProjection(artifact);
    expect(projection).toContain('semanticAtoms:');
    expect(projection).toContain('verified=');
    expect(projection).toContain('unverified=');
    expect(projection).not.toContain(largeCodeTail);
    expect(renderCompressionArtifactSummary(artifact)).toContain('## Goal');
  });

  it('carries lineage across consecutive compactions without deleting superseded atoms', () => {
    const atomA: CompressionSemanticAtom = {
      id: 'atom-a',
      type: 'decision',
      canonicalIdentity: 'decision:original-plan',
      severity: 'important',
      confidence: 0.9,
      scope: 'task',
      polarity: 'positive',
      status: 'verified',
      text: 'Use the original plan.',
      evidenceRefs: [{ type: 'session', ref: 'message:1' }],
    };
    const first = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Start planning.' }] as never,
      semanticAtoms: [atomA],
    });
    const second = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Revise the plan.' }] as never,
      previousArtifact: first,
      semanticAtoms: [
        {
          id: 'atom-b',
          type: 'decision',
          canonicalIdentity: 'decision:revised-plan',
          severity: 'critical',
          confidence: 0.95,
          scope: 'task',
          polarity: 'neutral',
          status: 'verified',
          text: 'Use the revised plan.',
          evidenceRefs: [{ type: 'session', ref: 'message:2' }],
          supersedes: ['atom-a'],
        },
        {
          id: 'atom-c',
          type: 'constraint',
          canonicalIdentity: 'constraint:conflict-visible',
          severity: 'important',
          confidence: 0.85,
          scope: 'task',
          polarity: 'negative',
          status: 'verified',
          text: 'The revised plan conflicts with the original plan.',
          evidenceRefs: [{ type: 'session', ref: 'message:3' }],
          conflicts: ['atom-a'],
        },
      ],
    });

    const ledger = second.semanticAtoms ?? [];
    const carriedA = ledger.find((atom) => atom.id === 'atom-a');
    const carriedB = ledger.find((atom) => atom.id === 'atom-b');

    expect(first.semanticAtoms?.find((atom) => atom.id === 'atom-a')?.status).toBe('verified');
    expect(carriedA?.status).toBe('superseded');
    expect(carriedB?.status).toBe('verified');
    expect(ledger.map((atom) => atom.id)).toEqual(expect.arrayContaining(['atom-a', 'atom-b', 'atom-c']));

    const projection = renderRecoveryContextProjection(second);
    expect(projection).toContain('superseded=1');
    expect(projection).toContain('conflicts=1');
    expect(projection).toContain('Use the revised plan.');
    expect(projection).toContain('Use the original plan.');
  });

  it('carries the previous normalized artifact into compaction preparation', () => {
    const previousArtifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Prepare a lineage-carrying compaction.' }] as never,
      semanticAtoms: [
        {
          id: 'atom-prep-a',
          type: 'goal',
          canonicalIdentity: 'goal:lineage',
          severity: 'critical',
          confidence: 1,
          scope: 'session',
          polarity: 'positive',
          status: 'verified',
          text: 'Preserve lineage across compaction.',
          evidenceRefs: [{ type: 'session', ref: 'message:1' }],
        },
      ],
    });
    const entries = [
      {
        type: 'compaction',
        id: 'compaction-1',
        parentId: null,
        timestamp: '2026-08-17T00:00:00.000Z',
        summary: 'Previous compaction summary.',
        firstKeptEntryId: 'message-1',
        tokensBefore: 200,
        details: { artifact: previousArtifact },
      },
      {
        type: 'message',
        id: 'message-1',
        parentId: 'compaction-1',
        timestamp: '2026-08-17T00:01:00.000Z',
        message: { id: 'message-1', role: 'user', content: 'Continue with lineage.' },
      },
    ] as never;

    const preparation = prepareCompaction(entries, {
      enabled: true,
      reserveTokens: 100,
      keepRecentTokens: 100_000,
      contextWindow: 100_000,
    });

    expect(preparation.ok).toBe(true);
    if (!preparation.ok) return;
    expect(preparation.value?.previousSummary).toBe('Previous compaction summary.');
    expect(preparation.value?.previousArtifact?.semanticAtoms?.map((atom) => atom.id)).toContain('atom-prep-a');
    expect(preparation.value?.previousArtifact?.schemaVersion).toBe(1);
  });

  it('leaves previousArtifact undefined when no prior compaction exists', () => {
    const preparation = prepareCompaction(
      [
        {
          type: 'message',
          id: 'message-1',
          parentId: null,
          timestamp: '2026-08-17T00:00:00.000Z',
          message: { id: 'message-1', role: 'user', content: 'First message.' },
        },
      ] as never,
      { enabled: true, reserveTokens: 100, keepRecentTokens: 100_000, contextWindow: 100_000 },
    );

    expect(preparation.ok).toBe(true);
    if (!preparation.ok) return;
    expect(preparation.value?.previousArtifact).toBeUndefined();
  });

  it('normalizes semanticAtoms at the Electron host boundary instead of trusting unknown spread', async () => {
    const { mapCompressionArtifact } = await import('@electron/services/sessions-api');
    const legacyQuality = {
      score: 1,
      level: 'high',
      fieldCoverage: 1,
      evidenceCoverage: 1,
      artifactTokens: 10,
      projectionTokens: 10,
      warnings: [],
    };
    const mapped = mapCompressionArtifact({
      schemaVersion: 1,
      objective: 'Mapped fixture',
      constraints: [],
      currentState: 'Mapped fixture',
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      filesTouched: [],
      testsRun: [],
      failedAttempts: [],
      deviations: [],
      nextAction: 'Continue',
      reviewNeeded: [],
      evidenceRefs: [],
      unverifiedClaims: [],
      quality: legacyQuality,
      semanticAtoms: [
        {
          id: 'electron-atom-a',
          type: 'goal',
          canonicalIdentity: 'goal:mapped',
          severity: 'critical',
          confidence: 0.9,
          scope: 'session',
          polarity: 'positive',
          status: 'verified',
          text: 'A critical atom with no evidence at the Electron boundary.',
          evidenceRefs: [],
        },
      ],
    });

    expect(mapped?.semanticAtoms?.[0]?.status).toBe('unverified');
    expect(mapped?.quality.warnings).toContain('critical_atom_missing_evidence');
  });

  it('uses the same semantic normalization for session previews and runtime recovery', async () => {
    const { mapCompressionArtifact } = await import('@electron/services/sessions-api');
    const raw = {
      ...buildDeterministicCompressionArtifact({ messages: [] }),
      semanticAtoms: [{ id: 'unknown-state', type: 'decision', severity: 'critical', confidence: 1,
        canonicalIdentity: 'decision', scope: 'turn:1', polarity: 'negative', status: 'agent_approved',
        text: 'Probe A is excluded.', evidenceRefs: [{ type: 'tool', ref: 'result-A' }] }],
    };
    const mapped = mapCompressionArtifact(raw)!;
    expect(mapped.semanticAtoms).toEqual(normalizeCompressionArtifact(raw)?.semanticAtoms);
    expect(mapped.semanticAtoms?.[0]).toMatchObject({ status: 'unverified', sourceStatus: 'agent_approved',
      scope: 'turn:1', polarity: 'negative' });
    expect(mapCompressionArtifact({ ...raw, semanticAtoms: [{ type: 'invalid', text: 'INVALID' }] })?.semanticAtoms).toBeUndefined();
    expect(mapCompressionArtifact(mapped)?.semanticAtoms).toEqual(mapped.semanticAtoms);
  });

  it('retains current goals and next actions before lower-priority semantic records under pressure', () => {
    const base: CompressionSemanticAtom = { id: 'observation', type: 'entity', canonicalIdentity: 'observation',
      severity: 'nice_to_have', confidence: 1, scope: 'session', polarity: 'neutral', status: 'verified',
      text: 'Supporting observation.', evidenceRefs: [{ type: 'tool', ref: 'observed' }] };
    const artifact = buildDeterministicCompressionArtifact({ messages: [], semanticAtoms: [
      ...Array.from({ length: 32 }, (_, index) => ({ ...base, id: `entity-${index}`, text: `Observation ${index}.` })),
      { ...base, id: 'goal', type: 'goal', severity: 'critical', text: 'Ship the owner-approved revision.' },
      { ...base, id: 'next', type: 'next_action', severity: 'critical', text: 'Read the unresolved receipt.' },
    ] });
    const projection = renderRecoveryContextProjection(artifact, 200);
    expect(projection.length).toBeLessThanOrEqual(800);
    expect(projection).toContain('Ship the owner-approved revision.');
    expect(projection).toContain('Read the unresolved receipt.');
    expect(projection).toContain('omitted by budget');
    expect(renderCompressionArtifactSummary(artifact)).not.toContain('- - [');
    artifact.currentState = 'Supporting current state. '.repeat(20);
    const withLargeState = renderRecoveryContextProjection(artifact, 200);
    expect(withLargeState).toContain('Ship the owner-approved revision.');
    expect(withLargeState).toContain('Read the unresolved receipt.');
    expect(withLargeState.length).toBeLessThanOrEqual(800);
  });

  it('retains active legacy recovery fields before retired semantic records', () => {
    const artifact = buildDeterministicCompressionArtifact({ messages: [], semanticAtoms: Array.from({ length: 30 }, (_, i) => ({
      id: `retired-${i}`, type: 'decision', canonicalIdentity: `old-${i}`, severity: 'critical', confidence: 1,
      scope: 'session', polarity: 'positive', status: 'superseded', text: `Old decision ${i}.`,
      evidenceRefs: [{ type: 'tool', ref: `old-${i}` }],
    })) });
    artifact.objective = 'Current goal.';
    artifact.nextAction = 'Current next step.';
    artifact.currentState = 'Current state.';
    artifact.constraints = [{ text: 'Current constraint.', evidenceRefs: [{ type: 'session', ref: 'current-rule' }] }];
    artifact.blocked = [{ text: 'Current blocker.', evidenceRefs: [{ type: 'tool', ref: 'current-blocker' }] }];
    const projection = renderRecoveryContextProjection(artifact, 200);
    for (const text of ['Current goal.', 'Current next step.', 'Current state.', 'Current constraint.', 'Current blocker.']) {
      expect(projection).toContain(text);
    }
    expect(projection.length).toBeLessThanOrEqual(800);
  });

  it('prioritizes semantic current state over earlier supporting entities', () => {
    const base: CompressionSemanticAtom = { id: 'entity', type: 'entity', canonicalIdentity: 'support',
      severity: 'important', confidence: 1, scope: 'session', polarity: 'neutral', status: 'verified',
      text: 'Supporting observation.', evidenceRefs: [{ type: 'tool', ref: 'observation' }] };
    const artifact = buildDeterministicCompressionArtifact({ messages: [], semanticAtoms: [
      ...Array.from({ length: 32 }, (_, i) => ({ ...base, id: `entity-${i}` })),
      { ...base, id: 'state', type: 'outcome', text: 'Current task remains blocked on reconciliation.' },
    ] });
    const projection = renderRecoveryContextProjection(artifact, 200);
    expect(projection).toContain('Current task remains blocked on reconciliation.');
    expect(projection.indexOf('Current task remains blocked')).toBeLessThan(projection.indexOf('Supporting observation.'));
    expect(projection.length).toBeLessThanOrEqual(800);
  });

  it('places unconfirmed-turn preferences after confirmed recovery fields', () => {
    const artifact = buildDeterministicCompressionArtifact({ messages: [], semanticAtoms: Array.from({ length: 24 }, (_, i) => ({
      id: `turn-${i}`, type: 'constraint', canonicalIdentity: `turn-${i}`, severity: 'critical', confidence: 1,
      scope: 'turn:1', polarity: 'positive', status: 'verified', text: `Temporary preference ${i}.`,
      evidenceRefs: [{ type: 'session', ref: `turn-1-${i}` }],
    })) });
    artifact.currentState = 'Current known state.';
    artifact.inProgress = [{ text: 'Current active work.', evidenceRefs: [{ type: 'tool', ref: 'current' }] }];
    artifact.blocked = [{ text: 'Current unresolved effect.', evidenceRefs: [{ type: 'tool', ref: 'effect' }] }];
    const projection = renderRecoveryContextProjection(artifact, 200);
    for (const text of ['Current known state.', 'Current active work.', 'Current unresolved effect.']) expect(projection).toContain(text);
    expect(projection.length).toBeLessThanOrEqual(800);
  });

  it('budgets independent legacy lists by individual records before historical atoms', () => {
    const artifact = buildDeterministicCompressionArtifact({ messages: [], semanticAtoms: [{
      id: 'history', type: 'entity', canonicalIdentity: 'history', severity: 'important', confidence: 1,
      scope: 'session', polarity: 'positive', status: 'superseded', text: 'Historical observation.', evidenceRefs: [],
    }] });
    artifact.constraints = Array.from({ length: 5 }, (_, i) => ({ text: `Constraint ${i}: ${'x'.repeat(135)}`,
      evidenceRefs: [{ type: 'session' as const, ref: `user-${i}` }] }));
    const projection = renderRecoveryContextProjection(artifact, 200);
    expect(projection).toContain(artifact.constraints[0].text);
    expect(projection).toContain('omitted by budget');
    expect(projection.length).toBeLessThanOrEqual(800);
  });


});
