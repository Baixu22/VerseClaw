// @vitest-environment node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractJsonObject,
  repairTruncatedJson,
} from '../../scripts/context-compression-json-repair.mjs';
import {
  actionSignature,
  aggregateContinuationEvaluations,
  aggregateFactSetEvaluations,
  assertModelIndependence,
  assessLayer3Gate,
  assessLayer1Gate,
  buildEvalSampleMatrix,
  buildFailureGuidelines,
  buildFaithfulnessJudgePrompt,
  classifyPairedTrajectory,
  evaluateDeterministicFaithfulness,
  evaluateContinuationScenario,
  evaluateCausalChains,
  evaluateFactSet,
  paraphraseSemanticMatcher,
  summarizePairedTrajectoryMetrics,
  type AnnotatedFact,
  type DownstreamAction,
  type PairedTrajectoryRow,
} from './helpers/context-compression-eval';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('context compression eval foundation', () => {
  const REAL_CONTEXT_EVAL_TIMEOUT_MS = 30_000;

  const fact = (id: string, text: string, severity: AnnotatedFact['severity'], category: AnnotatedFact['category']): AnnotatedFact => ({
    id,
    text,
    severity,
    category,
  });
  const readAllFiles = (root: string): string => {
    const stack = [root];
    const chunks: string[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      const stat = statSync(current);
      if (stat.isDirectory()) {
        for (const child of readdirSync(current)) stack.push(join(current, child));
      } else if (stat.isFile()) {
        chunks.push(readFileSync(current, 'utf8'));
      }
    }
    return chunks.join('\n');
  };
  const runRealContextEval = (
    name: string,
    transcriptLines: unknown[],
    extraArgs: string[] = [],
    envOverrides: NodeJS.ProcessEnv = {},
  ) => {
    const root = mkdtempSync(join(tmpdir(), `context-compression-${name}-`));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(
      join(transcriptRoot, 'session.jsonl'),
      `${transcriptLines.map((line) => JSON.stringify(line)).join('\n')}\n`,
      'utf8',
    );
    try {
      execFileSync(process.execPath, [
        'scripts/context-compression-eval-runner.mjs',
        '--target',
        process.cwd(),
        '--samples',
        '1',
        '--suite',
        'daily',
        '--sample-source',
        'real',
        '--transcript-root',
        transcriptRoot,
        '--turn-cohorts',
        '50',
        '--pressure-cohorts',
        '0.60',
        '--no-cache',
        '--out',
        outRoot,
        ...extraArgs,
      ], {
        cwd: process.cwd(),
        env: { ...process.env, ...envOverrides },
        stdio: 'pipe',
        windowsHide: true,
      });
    } catch (error) {
      if (!existsSync(join(outRoot, 'latest-run.txt'))) throw error;
    }
    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    const samples = readFileSync(join(latestRun, 'samples.jsonl'), 'utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const report = readFileSync(join(latestRun, 'report.md'), 'utf8');
    return { latestRun, summary, samples, report };
  };

  it('repairs only bounded JSON truncation and rejects unrelated invalid text', () => {
    const complete = { actions: [{ id: 'R1-continue' }], completed: true, rationale: 'verified' };
    const encoded = JSON.stringify(complete);
    expect(extractJsonObject(encoded)).toEqual(complete);
    expect(extractJsonObject(encoded.slice(0, -1))).toEqual(complete);
    expect(repairTruncatedJson('{"actions":[{"id":"R1-continue"}],"completed":true,')).toEqual({
      actions: [{ id: 'R1-continue' }],
      completed: true,
    });
    expect(() => extractJsonObject('not JSON and not recoverable')).toThrow(/did not contain JSON/u);
  });

  it('scores facts by exact and normalized matches with severity weighting', () => {
    const expected = [
      fact('critical-objective', 'Use host-api boundary', 'critical', 'constraint'),
      fact('important-test', 'pnpm run typecheck passed', 'important', 'test_result'),
      fact('nice-ui', 'icon row sits below message', 'nice_to_have', 'ui_detail'),
    ];
    const forbidden = [
      fact('stale-ipc', 'call renderer ipc directly', 'critical', 'constraint'),
    ];
    const result = evaluateFactSet({
      haystack: 'Use host API boundary. pnpm run typecheck passed.',
      expected,
      forbidden,
      originalText: 'Use host API boundary. pnpm run typecheck passed. icon row sits below message. call renderer ipc directly.',
      compressedText: 'Use host API boundary. pnpm run typecheck passed.',
    });

    expect(result.expectedFound).toBe(2);
    expect(result.forbiddenFound).toBe(0);
    expect(result.matchLevelCounts).toMatchObject({ exact: 1, normalized: 1, missing: 1 });
    expect(result.recallBySeverity.critical.recall).toBe(1);
    expect(result.recallBySeverity.important.recall).toBe(1);
    expect(result.recallBySeverity.nice_to_have.recall).toBe(0);
    expect(result.weightedRecall).toBeCloseTo(5 / 6, 5);
    expect(result.compressionRatio).toBeGreaterThan(0);
    expect(result.informationDensity).toBeGreaterThan(1);
  });

  it('supports pluggable semantic matching while keeping CI deterministic by default', () => {
    const expected = [
      {
        ...fact('decision', 'switch to host-api proxy', 'critical', 'decision'),
        acceptableParaphrases: ['use the main-process host API route'],
      },
    ];

    expect(evaluateFactSet({
      haystack: 'We will use the main process host API route.',
      expected,
    }).expectedFound).toBe(0);

    const withSemantic = evaluateFactSet({
      haystack: 'We will use the main process host API route.',
      expected,
      matchOptions: { semanticMatcher: paraphraseSemanticMatcher },
    });

    expect(withSemantic.expectedFound).toBe(1);
    expect(withSemantic.matchLevelCounts).toMatchObject({ semantic: 1, missing: 0 });
    expect(withSemantic.expectedMatches[0]).toMatchObject({
      level: 'semantic',
      evidence: 'use the main-process host API route',
    });
  });

  it('aggregates cohort metrics without hiding worst-case recall', () => {
    const critical = fact('critical', 'keep critical', 'critical', 'decision');
    const nice = fact('nice', 'keep detail', 'nice_to_have', 'ui_detail');
    const scores = [
      evaluateFactSet({ haystack: 'keep critical keep detail', expected: [critical, nice] }),
      evaluateFactSet({ haystack: 'keep critical', expected: [critical, nice] }),
    ];

    const aggregate = aggregateFactSetEvaluations(scores);

    expect(aggregate.rounds).toBe(2);
    expect(aggregate.recallMean).toBe(0.75);
    expect(aggregate.recallMin).toBe(0.5);
    expect(aggregate.recallCriticalMin).toBe(1);
    expect(aggregate.recallNiceToHaveMean).toBe(0.5);
    expect(aggregate.expectedFoundTotal).toBe(3);
    expect(aggregate.expectedTotal).toBe(4);
  });

  it('builds controlled sample matrices for L1 regression coverage', () => {
    const matrix = buildEvalSampleMatrix({
      transcriptLengths: ['short', 'long'],
      editPositions: ['early', 'late'],
      factDensities: ['sparse', 'dense'],
      baseFacts: 12,
    });

    expect(matrix).toHaveLength(8);
    expect(matrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'short-early-sparse',
        transcriptLength: 'short',
        editPosition: 'early',
        factDensity: 'sparse',
        multiEditCount: 1,
      }),
      expect.objectContaining({
        id: 'long-late-dense',
        totalFacts: 24,
        causalChainCount: 3,
      }),
    ]));
  });

  it('reports Layer 1 gate failures instead of hiding below-threshold baselines', () => {
    const critical = fact('critical', 'critical fact', 'critical', 'decision');
    const nice = fact('nice', 'nice detail', 'nice_to_have', 'ui_detail');
    const aggregate = aggregateFactSetEvaluations([
      evaluateFactSet({
        haystack: 'critical fact',
        expected: [critical, nice],
        originalText: 'critical fact nice detail plus a lot of original context',
        compressedText: 'critical fact',
      }),
    ]);

    const gate = assessLayer1Gate(aggregate);

    expect(gate.pass).toBe(false);
    expect(gate.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'recallNiceToHave.mean', pass: false }),
      expect.objectContaining({ id: 'weightedRecall.mean', pass: false, expected: '>= 0.9' }),
    ]));
  });

  it('evaluates deterministic causal-chain preservation', () => {
    const chain = {
      id: 'retry-plan',
      steps: [
        fact('tried-a', 'tried direct IPC', 'critical', 'decision'),
        fact('failed-a', 'failed because renderer boundary', 'critical', 'blocker'),
        fact('switched-b', 'switched to host-api proxy', 'critical', 'decision'),
      ],
      criticalStepIds: ['tried-a', 'failed-a', 'switched-b'],
    };

    expect(evaluateCausalChains({
      haystack: 'Tried direct IPC, failed because renderer boundary, then switched to host API proxy.',
      chains: [chain],
    })).toMatchObject({
      totalChains: 1,
      preservedChains: 1,
      preservationRate: 1,
    });

    expect(evaluateCausalChains({
      haystack: 'Switched to host API proxy.',
      chains: [chain],
    })).toMatchObject({
      totalChains: 1,
      preservedChains: 0,
      preservationRate: 0,
    });
  });

  it('builds an LLM judge prompt with annotated facts and causal chains', () => {
    const decision = fact('decision', 'Use host-api proxy', 'critical', 'decision');
    const prompt = buildFaithfulnessJudgePrompt({
      originalTranscript: 'Original transcript',
      compressedSummary: 'Compressed summary',
      expectedFacts: [decision],
      causalChains: [{
        id: 'chain-1',
        steps: [decision],
      }],
    });

    expect(prompt).toContain('## Original Transcript');
    expect(prompt).toContain('## Compressed Summary');
    expect(prompt).toContain('[critical/decision] Use host-api proxy');
    expect(prompt).toContain('Return strict JSON');
  });

  it('detects deterministic L2 faithfulness failures for contradictions, fabrication, and broken causal chains', () => {
    const tried = fact('tried-direct-ipc', 'tried direct IPC', 'critical', 'decision');
    const failed = fact('failed-boundary', 'failed because renderer boundary', 'critical', 'blocker');
    const switched = fact('switched-host-api', 'switched to host-api proxy', 'critical', 'decision');
    const contradiction = fact('contradict-direct-ipc', 'direct IPC is the approved path', 'critical', 'decision');
    const fabrication = fact('fabricated-test', 'Playwright mobile suite passed', 'important', 'test_result');

    const result = evaluateDeterministicFaithfulness({
      originalText: 'We tried direct IPC, it failed because renderer boundary, then switched to host-api proxy.',
      summaryText: 'We switched to host-api proxy. direct IPC is the approved path. Playwright mobile suite passed.',
      expectedFacts: [tried, failed, switched],
      contradictionProbes: [{
        id: 'ipc-policy',
        original: switched,
        contradiction,
      }],
      fabricationProbes: [{ id: 'fake-test', fabricated: fabrication }],
      causalChains: [{
        id: 'ipc-chain',
        steps: [tried, failed, switched],
        criticalStepIds: ['tried-direct-ipc', 'failed-boundary', 'switched-host-api'],
      }],
    });

    expect(result).toMatchObject({
      completeness: false,
      accuracy: false,
      causalChain: false,
      noFabrication: false,
      actionability: false,
      fabricatedFactsFound: 1,
      contradictionRate: 1,
      causalChainPreservation: 0,
    });
    expect(result.score).toBeLessThan(5);
    expect(result.contradictions).toEqual([{
      id: 'ipc-policy',
      originalFactId: 'switched-host-api',
      contradictionFactId: 'contradict-direct-ipc',
    }]);
  });

  it('aggregates downstream continuation outcomes', () => {
    const aggregate = aggregateContinuationEvaluations([
      {
        taskId: 'a',
        firstActionMatch: true,
        criticalActionMatch: true,
        noRepeatedWork: true,
        noContradictoryAction: true,
        completedWithFullContext: true,
        completedWithCompressedContext: true,
      },
      {
        taskId: 'b',
        firstActionMatch: false,
        criticalActionMatch: true,
        noRepeatedWork: false,
        noContradictoryAction: true,
        completedWithFullContext: true,
        completedWithCompressedContext: false,
      },
    ]);

    expect(aggregate).toMatchObject({
      total: 2,
      firstActionMatchRate: 0.5,
      criticalActionMatchRate: 1,
      noRepeatedWorkRate: 0.5,
      noContradictoryActionRate: 1,
      decisionConsistencyRate: 1,
      taskCompletionDelta: 0.5,
    });
  });

  it('evaluates L3 continuation traces against a full-context golden path', () => {
    const fullContextActions: DownstreamAction[] = [
      { id: 'read-chat', kind: 'read_file', target: 'src/stores/chat.ts', critical: true },
      { id: 'edit-chat', kind: 'edit_file', target: 'src/stores/chat.ts', critical: true },
      { id: 'run-unit', kind: 'run_test', target: 'tests/unit/host-services.test.ts', critical: true },
      { id: 'choose-host-api', kind: 'decision', decision: 'host-api-truncate', critical: true },
    ];
    const compressedActions: DownstreamAction[] = [
      { id: 'read-chat-c', kind: 'read_file', target: 'src/stores/chat.ts' },
      { id: 'edit-chat-c', kind: 'edit_file', target: 'src/stores/chat.ts' },
      { id: 'run-unit-c', kind: 'run_test', target: 'tests/unit/host-services.test.ts' },
      { id: 'choose-host-api-c', kind: 'decision', decision: 'host-api-truncate' },
    ];

    expect(actionSignature(fullContextActions[0])).toBe(actionSignature(compressedActions[0]));
    expect(actionSignature({ ...compressedActions[0], label: 'human-readable label only' }))
      .toBe(actionSignature(compressedActions[0]));
    expect(evaluateContinuationScenario({
      taskId: 'resend-flow',
      fullContextActions,
      compressedActions,
      completedActionIdsBeforeResume: [],
      rejectedDecisionIds: ['direct-ipc'],
      completedWithFullContext: true,
      completedWithCompressedContext: true,
    })).toMatchObject({
      taskId: 'resend-flow',
      firstActionMatch: true,
      criticalActionMatch: true,
      noRepeatedWork: true,
      noContradictoryAction: true,
    });
  });

  it('detects repeated work and contradictory actions in L3 continuation traces', () => {
    const fullContextActions: DownstreamAction[] = [
      { id: 'completed-build', kind: 'run_test', target: 'pnpm run build:vite', critical: false },
      { id: 'edit-chat', kind: 'edit_file', target: 'src/stores/chat.ts', critical: true },
      { id: 'choose-host-api', kind: 'decision', decision: 'host-api-truncate', critical: true },
    ];
    const compressedActions: DownstreamAction[] = [
      { id: 'repeat-build', kind: 'run_test', target: 'pnpm run build:vite', repeatsCompletedActionId: 'completed-build' },
      { id: 'choose-direct-ipc', kind: 'decision', decision: 'direct-ipc', contradictsDecisionId: 'choose-host-api' },
    ];

    expect(evaluateContinuationScenario({
      taskId: 'bad-resume',
      fullContextActions,
      compressedActions,
      completedActionIdsBeforeResume: ['completed-build'],
      rejectedDecisionIds: ['direct-ipc'],
      completedWithFullContext: true,
      completedWithCompressedContext: false,
    })).toMatchObject({
      firstActionMatch: true,
      criticalActionMatch: false,
      noRepeatedWork: false,
      noContradictoryAction: false,
    });
  });

  it('gates L3 downstream efficacy aggregates with benchmark thresholds', () => {
    const aggregate = aggregateContinuationEvaluations([
      evaluateContinuationScenario({
        taskId: 'good',
        fullContextActions: [
          { id: 'edit', kind: 'edit_file', target: 'src/a.ts', critical: true },
        ],
        compressedActions: [
          { id: 'edit-c', kind: 'edit_file', target: 'src/a.ts' },
        ],
        completedWithFullContext: true,
        completedWithCompressedContext: true,
      }),
      evaluateContinuationScenario({
        taskId: 'bad',
        fullContextActions: [
          { id: 'edit', kind: 'edit_file', target: 'src/b.ts', critical: true },
        ],
        compressedActions: [
          { id: 'ask', kind: 'ask_user', label: 'what next' },
        ],
        completedWithFullContext: true,
        completedWithCompressedContext: false,
      }),
    ]);

    const gate = assessLayer3Gate(aggregate);

    expect(gate.pass).toBe(false);
    expect(gate.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'firstActionMatch.rate', pass: false }),
      expect.objectContaining({ id: 'taskCompletion.delta', pass: false }),
    ]));
  });

  it('extracts evidence-backed failure chains and derives the next action from an unresolved failing test', () => {
    const { samples } = runRealContextEval('failure-chain', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: preserve a tried -> failed -> adjusted -> validation failed handoff for context compression.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Attempt: run pnpm exec vitest run tests/unit/context-compression-eval.test.ts before adding fixture coverage in scripts/context-compression-eval-runner.mjs.' } },
      {
        type: 'message',
        id: 'tool-fail',
        message: {
          role: 'tool',
          content: [
            'pnpm exec vitest run tests/unit/context-compression-eval.test.ts',
            'Exit code: 1',
            'Tests 1 failed | 9 passed',
            'AssertionError: expected compressed summary to keep the failure chain',
            '    at tests/unit/context-compression-eval.test.ts:410:12',
          ].join('\n'),
        },
      },
      { type: 'message', id: 'a2', message: { role: 'assistant', content: 'Adjustment: switched to explicit failure-chain fixture coverage in tests/unit/context-compression-eval.test.ts.' } },
      {
        type: 'message',
        id: 'tool-still-fail',
        message: {
          role: 'tool',
          content: [
            'pnpm exec vitest run tests/unit/context-compression-eval.test.ts',
            'Exit code: 1',
            'Tests 1 failed | 10 passed',
            'AssertionError: next action was too generic',
          ].join('\n'),
        },
      },
      ...Array.from({ length: 60 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: src/failure-chain-${index}.ts keeps ballast.` },
      })),
    ]);

    const compressed = samples[0].compressedSummary;
    expect(compressed).toContain('## Critical Fact Ledger');
    expect(compressed).toContain('Failure chain:');
    expect(compressed).toContain('attempt=');
    expect(compressed).toContain('nextAction=');
    expect(compressed).toContain('classification=test_failure');
    expect(compressed).toContain('AssertionError: next action was too generic');
    expect(compressed).toContain('Inspect/fix the failing test');
    expect(compressed).toContain('tool-still-fail@');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('classifies Windows and rg quoting failures as invocation issues with corrected-scan next actions', () => {
    const { samples } = runRealContextEval('windows-quoting', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: scan context compression files without mistaking shell quoting failures for product blockers.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Attempt: scan with rg "function buildRealSummary(" scripts/context-compression-eval-runner.mjs.' } },
      {
        type: 'message',
        id: 'rg-quoting',
        message: {
          role: 'tool',
          content: [
            'rg "function buildRealSummary(" scripts/context-compression-eval-runner.mjs',
            'Exit code: 2',
            'regex parse error:',
            '    function buildRealSummary(',
            '                             ^',
            'error: unclosed group',
          ].join('\n'),
        },
      },
      { type: 'message', id: 'a2', message: { role: 'assistant', content: 'Adjustment: fallback to fixed-string scan with rg -F "function buildRealSummary(" scripts/context-compression-eval-runner.mjs.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: scripts/context-compression-eval-runner.mjs quoting ballast.` },
      })),
    ]);

    const compressed = samples[0].compressedSummary;
    expect(compressed).toContain('classification=shell_quoting_failure');
    expect(compressed).toContain('rg/PowerShell pattern quoting or regex parsing failed, not product code behavior');
    expect(compressed).toContain('Rerun corrected command or use fixed-string scan');
    expect(compressed).toContain('one-pattern/fixed-string scans');
    expect(compressed).not.toContain('classification=product_or_code_failure');
  });

  it('promotes assistant objective, constraints, helper delegation, and corrected scan evidence from real-style windows', () => {
    const { samples } = runRealContextEval('real-window-objective-scan', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'a0', message: { role: 'assistant', content: 'The worktree is very dirty, and a lot of that predates me. I will treat it as user-owned state and keep Phase 17 changes narrowly additive so I do not disturb the surrounding work.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'The goal is still a small surface, not a new app path.' } },
      {
        type: 'message',
        id: 'cmd-quoting',
        message: {
          role: 'tool',
          content: [
            'cmd /d /s /c ""C:\\Users\\alice\\.cherrystudio\\bin\\rtk.exe" rg -n "RuntimeMemoryInspection|inspectRuntimeMemorySanitizedEpisodes" openclaw_runtime/src/runtime-core/memory-persistence.ts"',
            'Exit code: 1',
            'RuntimeMemoryInspection : The term \'RuntimeMemoryInspection\' is not recognized as the name of a cmdlet, function, script file, or operable program.',
          ].join('\n'),
        },
      },
      { type: 'message', id: 'a2', message: { role: 'assistant', content: 'The fourth scan confirms the new helper delegates to `inspectRuntimeMemorySanitizedEpisodes`. Some multi-pattern scans are still fighting shell quoting, so I am falling back to one-pattern/fixed-string scans and will record only commands that actually executed.' } },
      {
        type: 'message',
        id: 'empty-exit',
        message: {
          role: 'tool',
          content: [
            'rg -F "record_json" openclaw_runtime/src/runtime-core/memory-operator-inspection.ts',
            'Exit code: 1',
            'Output:',
          ].join('\n'),
        },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: openclaw_runtime/src/runtime-core/memory-operator-inspection.ts ballast.` },
      })),
    ]);

    const compressed = samples[0].compressedSummary;
    expect(compressed).toContain('small surface');
    expect(compressed).toContain('narrowly additive');
    expect(compressed).toContain('inspectRuntimeMemorySanitizedEpisodes');
    expect(compressed).toContain('one-pattern/fixed-string scans');
    expect(compressed).toContain('record only commands that actually executed');
    expect(compressed).toContain('classification=environment_or_invocation_failure');
    expect(compressed).not.toContain('No explicit objective evidence found');
    expect(compressed).not.toContain('No explicit constraint evidence found');
    expect(compressed).not.toContain('classification=product_or_code_failure');
  });

  it('promotes gateway startup hangs at ensureSessionStateMigrated inside plugins.bootstrap as current blocker evidence', () => {
    const { samples } = runRealContextEval('gateway-startup-blocker', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: preserve the concrete Gateway startup blocker in the handoff.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Attempt: run ClawX source runtime dev validation after fixing module resolution.' } },
      { type: 'message', id: 'a2', message: { role: 'assistant', content: 'Gateway startup is blocked at `ensureSessionStateMigrated()` inside plugins.bootstrap after the compiled runtime starts.' } },
      { type: 'message', id: 'a3', message: { role: 'assistant', content: 'Adjustment: skip the legacy state migration only for the isolated ClawX source runtime state directory.' } },
      { type: 'message', id: 'a4', message: { role: 'assistant', content: 'Validation result: source runtime Gateway connected after the migration skip and the WebSocket handshake completed.' } },
      ...Array.from({ length: 60 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: electron/gateway/config-sync.ts startup ballast.` },
      })),
    ]);

    const compressed = samples[0].compressedSummary;
    expect(compressed).toContain('ensureSessionStateMigrated');
    expect(compressed).toContain('plugins.bootstrap');
    expect(compressed).toContain('legacy state migration');
    expect(compressed).toContain('Gateway connected');
  });

  it('summarizes large tool/test output with command, exit code, counts, first error, and follow-up', () => {
    const repeatedFrames = Array.from({ length: 40 }, (_, index) => `    at repeated frame ${index} (src/noise-${index}.ts:1:1)`).join('\n');
    const { samples } = runRealContextEval('tool-summary', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: keep concrete failed test output in the context-compression handoff.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Attempt: run pnpm exec vitest run tests/unit/context-compression-eval.test.ts for regression validation.' } },
      {
        type: 'message',
        id: 'tool-large',
        message: {
          role: 'tool',
          content: [
            'pnpm exec vitest run tests/unit/context-compression-eval.test.ts',
            'Exit code: 1',
            'Test Files 1 failed | 2 passed',
            'Tests 3 failed | 17 passed',
            'TypeError: Cannot read properties of undefined (reading "failureSummary")',
            '    at scripts/context-compression-eval-runner.mjs:900:10',
            repeatedFrames,
          ].join('\n'),
        },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: tests/unit/context-compression-eval.test.ts output ballast.` },
      })),
    ]);

    const compressed = samples[0].compressedSummary;
    expect(compressed).toContain('Tool/test failure summary:');
    expect(compressed).toContain('command=pnpm exec vitest run tests/unit/context-compression-eval');
    expect(compressed).toContain('exitCode=1');
    expect(compressed).toContain('failing=1');
    expect(compressed).toContain('passing=2');
    expect(compressed).toContain('firstError=Test Files 1 failed | 2 passed');
    expect(compressed).toContain('Inspect/fix the failing test');
  });

  it('records hunk rehydration A/B evidence without storing large file bodies', () => {
    const { latestRun, summary, samples, report } = runRealContextEval('hunk-ab', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: validate rehydrated file hunks for continuation decisions.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Decision: edit scripts/context-compression-eval-runner.mjs and tests/unit/context-compression-eval.test.ts.' } },
      { type: 'message', id: 'a2', message: { role: 'assistant', content: 'Next action: inspect scripts/context-compression-eval-runner.mjs around the failure-chain extractor before rerunning tests.' } },
      ...Array.from({ length: 60 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: scripts/context-compression-eval-runner.mjs hunk ballast.` },
      })),
    ]);

    expect(samples[0].rehydratedFileContext[0]).toMatchObject({
      path: 'scripts/context-compression-eval-runner.mjs',
      reason: expect.any(String),
      excerptHash: expect.stringMatching(/^sha256:/),
      evidenceRefs: expect.any(Array),
    });
    expect(samples[0].rehydratedFileContext[0].lineWindow).toHaveProperty('start');
    expect(summary.hunkRehydrationAb.executed).toBe(true);
    expect(summary.hunkRehydrationAb.compared.withRehydratedFileContext.criticalActionMatchRate)
      .toBeGreaterThanOrEqual(summary.hunkRehydrationAb.compared.withoutRehydratedFileContext.criticalActionMatchRate);
    expect(summary.hunkRehydrationAb.compared.withRehydratedFileContext.noRepeatedWorkRate)
      .toBeGreaterThanOrEqual(summary.hunkRehydrationAb.compared.withoutRehydratedFileContext.noRepeatedWorkRate);
    expect(summary.hunkRehydrationAb.statisticalTests.criticalActionMatch).toMatchObject({
      pairedSamples: 1,
      statisticalPowerStatus: 'underpowered',
    });
    expect(summary.hunkRehydrationAb.robustness).toMatchObject({
      mode: 'deterministic_action_perturbation_proxy',
      deterministicTrialsPerSample: 3,
    });
    expect(summary.informationLoss.verifiedClaimsRetentionRate).toBe(1);
    expect(summary.latencyCost.tokenEconomics.totals).toHaveProperty('outputTokenDelta');
    expect(summary.degradationCurve.points.length).toBeGreaterThan(0);
    expect(summary.degradationCurve.continuationEvidenceMode).toBe('deterministic_proxy');
    expect(summary.humanEvaluation).toBeUndefined();
    expect(summary.agentManualEvaluation).toBeUndefined();
    expect(existsSync(join(latestRun, 'human-eval-pack.jsonl'))).toBe(false);
    expect(report).toContain('Hunk A/B');
    expect(report).toContain('Information Loss');
    expect(report).toContain('Degradation Curve');
    expect(report).not.toContain('Human Evaluation');
    expect(report).not.toContain('Agent Manual Evaluation');
  });

  it('runs the CLI hybrid suite with real transcript parsing, redaction, cohorts, and exact sample counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-real-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    const transcriptPath = join(transcriptRoot, 'session.jsonl');
    mkdirSync(transcriptRoot, { recursive: true });
    const lines = [
      {
        type: 'session',
        id: 'session-1',
        cwd: 'C:\\Users\\alice\\workspace\\demo',
      },
      {
        type: 'message',
        id: 'm-user',
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: 'Objective: implement context compression realism. Constraint: never persist authorization: Bearer live-token-1234567890 or sk-live1234567890abcdef.',
          }],
        },
      },
      {
        type: 'message',
        id: 'm-assistant',
        message: {
          role: 'assistant',
          content: 'Decision: extend the existing L0-L3 runner and edit scripts/context-compression-eval-runner.mjs.',
        },
      },
      {
        type: 'message',
        id: 'm-tool',
        message: {
          role: 'tool',
          content: 'pnpm exec vitest run tests/unit/context-compression-eval.test.ts failed because fixture coverage was missing.',
        },
      },
      {
        type: 'branch_summary',
        id: 'stale-branch',
        summary: 'STALE decision: replace the runner with a parallel benchmark.',
      },
      {
        type: 'message',
        id: 'm-next',
        message: {
          role: 'assistant',
          content: 'Next action: run pnpm exec vitest run tests/unit/context-compression-eval.test.ts after adding fixture coverage.',
        },
      },
      ...Array.from({ length: 60 }, (_, index) => ({
        type: 'message',
        id: `noise-${index + 1}`,
        message: {
          role: index % 2 ? 'assistant' : 'tool',
          content: `Neutral tool output ${index + 1}: stack trace frame and file context src/example-${index}.ts for cohort ballast.`,
        },
      })),
    ];
    writeFileSync(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    execFileSync(process.execPath, [
      'scripts/context-compression-eval-runner.mjs',
      '--target',
      process.cwd(),
      '--samples',
      '5',
      '--suite',
      'daily',
      '--sample-source',
      'hybrid',
      '--real-samples',
      '2',
      '--synthetic-samples',
      '3',
      '--transcript-root',
      transcriptRoot,
      '--turn-cohorts',
      '50',
      '--pressure-cohorts',
      '0.60,0.95',
      '--cache-dir',
      join(root, 'cache'),
      '--out',
      outRoot,
    ], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    expect(existsSync(join(latestRun, 'summary.json'))).toBe(true);
    expect(existsSync(join(latestRun, 'samples.jsonl'))).toBe(true);
    expect(existsSync(join(latestRun, 'report.md'))).toBe(true);
    expect(existsSync(join(latestRun, 'worst-cases.jsonl'))).toBe(true);

    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    const samplesJsonl = readFileSync(join(latestRun, 'samples.jsonl'), 'utf8').trim().split(/\r?\n/u);
    const combinedArtifacts = [
      readFileSync(join(latestRun, 'summary.json'), 'utf8'),
      readFileSync(join(latestRun, 'samples.jsonl'), 'utf8'),
      readFileSync(join(latestRun, 'report.md'), 'utf8'),
      readFileSync(join(latestRun, 'worst-cases.jsonl'), 'utf8'),
    ].join('\n');

    expect(summary.sampleCount).toBe(5);
    expect(samplesJsonl).toHaveLength(5);
    expect(summary.cohorts.real.sampleCount).toBe(2);
    expect(summary.cohorts.synthetic.sampleCount).toBe(3);
    expect(summary.cohorts.byPressure).toHaveProperty('0.6');
    expect(summary.cohortBreakdown.real.sampleCount).toBe(2);
    expect(summary.redactionSummary.replacements.apiKeys).toBeGreaterThan(0);
    expect(summary.redactionSummary.replacements.authHeaders + summary.redactionSummary.replacements.authTokens).toBeGreaterThan(0);
    expect(summary.acceptance.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sampleCount.exact', pass: true }),
      expect.objectContaining({ id: 'samplesJsonl.exact', pass: true }),
    ]));
    expect(combinedArtifacts).not.toMatch(/\bsk-[A-Za-z0-9_-]{12,}/u);
    expect(combinedArtifacts).not.toMatch(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu);
    expect(combinedArtifacts).not.toMatch(/\bauthorization\s*[:=]/iu);
  });

  it('reuses cache and replays a fixed sample manifest without leaking secrets', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-cache-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    const cacheDir = join(root, 'cache');
    const manifestPath = join(root, 'manifest.json');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1', cwd: 'C:\\Users\\alice\\workspace\\demo' },
      {
        type: 'message',
        id: 'm-user',
        message: { role: 'user', content: 'Objective: cache context compression. authorization: Bearer live-token-1234567890' },
      },
      {
        type: 'message',
        id: 'm-assistant',
        message: { role: 'assistant', content: 'Decision: write cache and manifest support in scripts/context-compression-eval-runner.mjs.' },
      },
      {
        type: 'message',
        id: 'm-tool',
        message: { role: 'tool', content: 'pnpm exec vitest run tests/unit/context-compression-eval.test.ts passed.' },
      },
      {
        type: 'message',
        id: 'm-next',
        message: { role: 'assistant', content: 'Next action: replay the manifest and confirm cache hits.' },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: src/cache-${index}.ts supports fixture ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    const baseArgs = [
      'scripts/context-compression-eval-runner.mjs',
      '--target', process.cwd(),
      '--samples', '2',
      '--suite', 'daily',
      '--sample-source', 'hybrid',
      '--real-samples', '1',
      '--synthetic-samples', '1',
      '--transcript-root', transcriptRoot,
      '--turn-cohorts', '50',
      '--pressure-cohorts', '0.60,0.95',
      '--cache-dir', cacheDir,
      '--out', outRoot,
    ];

    execFileSync(process.execPath, [...baseArgs, '--write-sample-manifest', manifestPath], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });
    const replayArgs = baseArgs.map((arg, index, args) => (
      args[index - 1] === '--pressure-cohorts' ? '0.6,0.95' : arg
    ));
    execFileSync(process.execPath, [...replayArgs, '--sample-manifest', manifestPath], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    const samplesJsonl = readFileSync(join(latestRun, 'samples.jsonl'), 'utf8').trim().split(/\r?\n/u);
    expect(summary.acceptance.status).toBe('PASS');
    expect(summary.cache.hits).toBeGreaterThan(0);
    expect(summary.cache.secretScan.pass).toBe(true);
    expect(summary.manifest).toMatchObject({ resolved: 2, requested: 2, missing: [] });
    expect(samplesJsonl).toHaveLength(2);
    expect(Object.keys(summary.cohorts.byPressure)).toContain('0.6');
    expect(summary.redactionSummary.replacements.authHeaders + summary.redactionSummary.replacements.authTokens).toBeGreaterThan(0);
    expect(readAllFiles(cacheDir)).not.toMatch(/Bearer\s+live-token-1234567890/iu);
    expect(readAllFiles(cacheDir)).not.toMatch(/\bauthorization\s*[:=]/iu);
  });

  it('replays a real manifest subset selected from a larger candidate pool', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-manifest-subset-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    const cacheDir = join(root, 'cache');
    const manifestPath = join(root, 'manifest.json');
    const subsetManifestPath = join(root, 'manifest-subset.json');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: replay a later manifest sample from a larger real pool.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: use exact manifest identity instead of only the first requested candidates.' } },
      { type: 'message', id: 't', message: { role: 'tool', content: 'pnpm exec vitest run tests/unit/context-compression-eval.test.ts passed.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: resolve R4 even when the replay asks for one sample.' } },
      ...Array.from({ length: 180 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: src/manifest-subset-${index}.ts keeps enough ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    const baseArgs = [
      'scripts/context-compression-eval-runner.mjs',
      '--target', process.cwd(),
      '--suite', 'daily',
      '--sample-source', 'real',
      '--transcript-root', transcriptRoot,
      '--turn-cohorts', '50,200',
      '--pressure-cohorts', '0.60,0.95',
      '--cache-dir', cacheDir,
      '--out', outRoot,
    ];
    execFileSync(process.execPath, [...baseArgs, '--samples', '4', '--write-sample-manifest', manifestPath], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(subsetManifestPath, `${JSON.stringify({
      ...manifest,
      requestedSampleCount: 1,
      samples: [manifest.samples[3]],
      sampleSelectionHash: createHash('sha256').update(stableJson([manifest.samples[3]])).digest('hex'),
    }, null, 2)}\n`, 'utf8');
    execFileSync(process.execPath, [...baseArgs, '--samples', '1', '--sample-manifest', subsetManifestPath], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    expect(summary.acceptance.status).toBe('PASS');
    expect(summary.manifest).toMatchObject({ resolved: 1, requested: 1, missing: [] });
    expect(JSON.parse(readFileSync(join(latestRun, 'samples.jsonl'), 'utf8').trim()).id).toBe(manifest.samples[3].id);
  });

  it('merges the authoritative tail into a real sample window', () => {
    const { samples } = runRealContextEval('authoritative-tail', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: preserve the latest recovery authority.' } },
      { type: 'message', id: 'early', message: { role: 'assistant', content: 'Decision: keep the earlier plan for context.' } },
      ...Array.from({ length: 80 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: src/tail-${index}.ts ballast.` },
      })),
      { type: 'message', id: 'tail-decision', message: { role: 'assistant', content: 'Decision: the tail authority supersedes the earlier plan.' } },
      { type: 'message', id: 'tail-next', message: { role: 'assistant', content: 'Next action: verify the authoritative tail fact.' } },
    ]);

    expect(samples[0].expectedFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidence: expect.objectContaining({ messageId: 'tail-decision' }) }),
      expect.objectContaining({ evidence: expect.objectContaining({ messageId: 'tail-next' }) }),
    ]));
    expect(samples[0].compressedSummary).toContain('the tail authority supersedes the earlier plan');
    expect(samples[0].compressedSummary).toContain('verify the authoritative tail fact');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('keeps objective-relevant verified completion ahead of a later unrelated task success', () => {
    const { samples } = runRealContextEval('objective-relevant-completion', [
      { type: 'session', id: 'session-1' },
      {
        type: 'message',
        id: 'objective',
        message: {
          role: 'user',
          content: 'Objective: use undo_write on ValidationException.java and verify that the comment is removed.',
        },
      },
      {
        type: 'message',
        id: 'undo-failure',
        message: {
          role: 'tool',
          content: 'undo_write ValidationException.java failed: the write operation was not reversible yet.',
        },
      },
      {
        type: 'message',
        id: 'undo-success',
        message: {
          role: 'assistant',
          content: '撤销成功并确认：ValidationException.java 已恢复到修改前的状态。验证：读取回显确认，注释已被移除。',
        },
      },
      {
        type: 'message',
        id: 'unrelated-success',
        message: {
          role: 'assistant',
          content: 'Created chain_audit_test.java and wrote 44 bytes successfully.',
        },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: unrelated follow-up ballast.` },
      })),
    ]);

    expect(samples[0].compressedSummary).toContain('Done/Validated');
    expect(samples[0].compressedSummary).toContain('ValidationException.java');
    expect(samples[0].compressedSummary).toContain('Task completed and verified');
    expect(samples[0].compressedSummary).toContain('comment');
    expect(samples[0].compressedSummary).not.toContain('chain_audit_test.java');
    expect(samples[0].compressedSummary).toContain('Do not redo completed work');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('never fabricates test results from manifest names inside explicit test-skip reports', () => {
    const { samples } = runRealContextEval('no-fabricated-cargo', [
      { type: 'session', id: 'session-1' },
      {
        type: 'message',
        id: 'objective',
        message: {
          role: 'user',
          content: 'Objective: create chain_audit_test.md under fixtures, write two lines, read it back, then undo_write it. Report every step with its tool and result.',
        },
      },
      {
        type: 'message',
        id: 'write-result',
        message: {
          role: 'toolResult',
          content: 'Successfully wrote 61 bytes to C:/workspace/fixtures/jforum-run/chain_audit_test.md\nverify_tests: skipped(no-manifest): No project manifest (package.json / pyproject.toml / Cargo.toml / go.mod) was found; no test suite was run.',
        },
      },
      {
        type: 'message',
        id: 'final-report',
        message: {
          role: 'assistant',
          content: 'chain_audit_test.md 已成功撤销（文件不再存在）。验证：读取返回 ENOENT，undo_write 返回 ok。',
        },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: unrelated follow-up ballast.` },
      })),
    ]);

    const summary = samples[0].compressedSummary;
    expect(summary).not.toMatch(/\n- Cargo\b/u);
    expect(summary).toContain('no test suite was run');
    const testsSection = summary.split('## Tests and Results')[1]?.split('\n## ')[0] ?? '';
    const bareToolBullet = testsSection
      .split('\n')
      .filter((line: string) => line.startsWith('- '))
      .some((line: string) => /^(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv|cargo|go|rg|git|powershell|pwsh|mvn|gradle|make|java)\s*$/iu.test(line.slice(2).trim()));
    expect(bareToolBullet).toBe(false);
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('does not mark an unexecuted objective complete from a later unrelated task success', () => {
    const { samples } = runRealContextEval('unexecuted-objective', [
      { type: 'session', id: 'session-1' },
      {
        type: 'message',
        id: 'objective',
        message: {
          role: 'user',
          content: '测试手动压缩：当前会话已经很长了，请用可用的压缩工具对手动压缩当前会话历史。如果找到压缩入口就执行它，报告压缩是否成功和压缩后的会话状态。',
        },
      },
      {
        type: 'message',
        id: 'investigation',
        message: {
          role: 'assistant',
          content: 'I can see the session context. The main session shows contextTokens: 1000000 and totalTokens: 109329. Let me look for a compaction mechanism.',
        },
      },
      {
        type: 'message',
        id: 'negative-report',
        message: {
          role: 'assistant',
          content: 'Key findings from my investigation: There is no dedicated manual-compaction tool exposed in my toolset. The openclaw CLI is not reachable from my shell (CommandNotFoundException). 结论：未能执行手动压缩，当前没有可用的手动压缩入口。',
        },
      },
      {
        type: 'message',
        id: 'next-task',
        message: {
          role: 'user',
          content: 'Another assignment: list the README.md contents of the project and summarize what it is in one sentence.',
        },
      },
      {
        type: 'message',
        id: 'unrelated-success',
        message: {
          role: 'assistant',
          content: 'Created chain_audit_test.md and wrote 44 bytes successfully.',
        },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: unrelated follow-up ballast.` },
      })),
    ]);

    const summary = samples[0].compressedSummary;
    expect(summary).not.toContain('Task completed and verified');
    expect(summary).not.toContain('Done/Validated');
    expect(summary).toContain('In Progress');
    expect(summary).toContain('Objective not verified complete in its own task segment');
    expect(summary).toContain('no dedicated manual-compaction tool');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('keeps numbered-task completion and tracking content scoped to the objective task', () => {
    const { samples } = runRealContextEval('numbered-task-tracking', [
      { type: 'session', id: 'session-1' },
      {
        type: 'message',
        id: 'objective',
        message: {
          role: 'user',
          content: '连续任务 #5：请阅读 JForum 项目 src/main/java 下任意一个 java 文件，用一句话总结它的作用。这是连续的第 5 个任务，请记住你之前已经分析过的文件避免重复。',
        },
      },
      {
        type: 'message',
        id: 'pick-file',
        message: {
          role: 'assistant',
          content: 'Task #5. Analyzed so far: #1 TopicWatchExtension, #2 AdminController, #3 AvatarAdminController, #4 BadWordAdminController. Picking net/jforum/controllers/BanlistAdminController.java.',
        },
      },
      {
        type: 'message',
        id: 'tracking-update',
        message: {
          role: 'toolResult',
          content: 'Successfully replaced 1 block(s) in C:/workspace/memory/jforum-analyzed-files.md.\nverify_tests: skipped(no-manifest): No project manifest (package.json / pyproject.toml / Cargo.toml / go.mod) was found; no test suite was run.',
        },
      },
      {
        type: 'message',
        id: 'task5-report',
        message: {
          role: 'assistant',
          content: '已完成第 5 个连续任务（避开了已分析的文件 #1–#4）。本次阅读的是 net/jforum/controllers/BanlistAdminController.java（文件 #5），作用是后台封禁名单管理控制器。📌 追踪更新：已将 BanlistAdminController.java 记为文件 #5。累计分析：- #1 TopicWatchExtension.java - #2 AdminController.java - #3 AvatarAdminController.java - #4 BadWordAdminController.java - #5 BanlistAdminController.java',
        },
      },
      {
        type: 'message',
        id: 'next-task',
        message: {
          role: 'user',
          content: '用终端命令列出 JForum 项目根目录内容，然后报告结果。',
        },
      },
      {
        type: 'message',
        id: 'unrelated-success',
        message: {
          role: 'assistant',
          content: 'Created chain_audit_test.md under JForum-master and wrote 44 bytes successfully.',
        },
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: unrelated follow-up ballast.` },
      })),
    ]);

    const summary = samples[0].compressedSummary;
    expect(summary).toContain('Done/Validated');
    expect(summary).toContain('已完成第 5 个连续任务');
    expect(summary).not.toContain('Task completed and verified: "Created chain_audit_test.md');
    expect(summary).toContain('累计分析');
    expect(summary).toContain('TopicWatchExtension.java');
    expect(summary).toContain('BadWordAdminController.java');
    expect(summary).not.toMatch(/\n- Cargo\b/u);
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('accepts canonical handoff headings for deterministic L2', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-canonical-headings-'));
    const pairedSummaryPath = join(root, 'paired.jsonl');
    writeFileSync(pairedSummaryPath, `${JSON.stringify({
      sampleId: 'R1',
      compressedSummary: [
        '## Goal and Progress',
        'Objective: preserve canonical handoff headings.',
        '',
        '## Attempts and Failures',
        'No failure evidence.',
        '',
        '## Decisions',
        'Decision: use the canonical Decisions heading.',
        '',
        '## Open TODOs',
        'Next action: run the canonical heading validation.',
        '',
        '## Constraints/Rules',
        'Constraint: keep evidence exact.',
        '',
        '## Pending user asks',
        'Next action: run the canonical heading validation.',
        '',
        '## Current State',
        'Ready for validation.',
        '',
        '## Files Touched',
        'tests/unit/context-compression-eval.test.ts',
        '',
        '## Tests',
        'Run the focused unit test.',
        '',
        '## Exact identifiers',
        'tests/unit/context-compression-eval.test.ts',
        '',
        '## Next Actions',
        'Next action: run the canonical heading validation.',
      ].join('\n'),
    })}\n`, 'utf8');

    const { summary } = runRealContextEval('canonical-headings', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: preserve canonical handoff headings.' } },
      { type: 'message', id: 'decision', message: { role: 'assistant', content: 'Decision: use the canonical Decisions heading.' } },
      { type: 'message', id: 'constraint', message: { role: 'assistant', content: 'Constraint: keep evidence exact.' } },
      { type: 'message', id: 'next', message: { role: 'assistant', content: 'Next action: run the canonical heading validation.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: canonical heading ballast.` },
      })),
    ], ['--paired-summary', pairedSummaryPath]);

    expect(summary.layer2Gate.pass).toBe(true);
    expect(summary.layer2).toMatchObject({
      causalChainRate: 1,
      actionabilityRate: 1,
    });
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('builds a model-free deterministic recovery batch', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-recovery-batch-'));
    const transcriptPath = join(root, 'session.jsonl');
    const manifestPath = join(root, 'manifest.json');
    const metaPath = join(root, 'meta.json');
    const outRoot = join(root, 'out');
    writeFileSync(transcriptPath, `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: build a model-free recovery batch.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: derive the summary from transcript evidence only.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: verify the deterministic batch metadata.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: deterministic batch ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
    writeFileSync(manifestPath, `${JSON.stringify({
      version: 2,
      samples: [{ id: 'R1', cohort: { turn: 50 } }],
    })}\n`, 'utf8');
    writeFileSync(metaPath, `${JSON.stringify({
      entries: [{ sampleId: 'R1', file: transcriptPath }],
    })}\n`, 'utf8');

    execFileSync(process.execPath, [
      'scripts/context-compression-deterministic-recovery-batch.mjs',
      '--manifest', manifestPath,
      '--meta', metaPath,
      '--out', outRoot,
    ], { cwd: process.cwd(), stdio: 'pipe', windowsHide: true });

    const metadata = JSON.parse(readFileSync(join(outRoot, 'batch-metadata.json'), 'utf8'));
    const summaryRow = JSON.parse(readFileSync(join(outRoot, 'would-retry-summaries.jsonl'), 'utf8').trim());
    expect(metadata).toMatchObject({ sampleCount: 1, model: 'none' });
    expect(summaryRow).toMatchObject({ sampleId: 'R1' });
    expect(summaryRow.compressedSummary).toContain('## Continuation Directive (authoritative)');
    expect(summaryRow.compressedSummary).toContain('verify the deterministic batch metadata');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('fails closed when a manifest declares a different sample count or selection hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-invalid-manifest-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    const manifestPath = join(root, 'manifest.json');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: reject malformed fixed manifests.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: manifest declarations are authoritative inputs.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: report an explicit invalid-manifest gate.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: malformed manifest fixture ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
    const validManifest = {
      version: 2,
      seed: 'context-compression-eval-v1',
      requestedSampleCount: 2,
      samples: [{ key: 'one', id: 'R1', source: 'real' }],
      sampleSelectionHash: 'stale-hash',
    };
    writeFileSync(manifestPath, `${JSON.stringify(validManifest)}\n`, 'utf8');
    expect(() => execFileSync(process.execPath, [
      'scripts/context-compression-eval-runner.mjs',
      '--target', process.cwd(),
      '--samples', '1',
      '--suite', 'daily',
      '--sample-source', 'real',
      '--transcript-root', transcriptRoot,
      '--turn-cohorts', '50',
      '--pressure-cohorts', '0.60',
      '--sample-manifest', manifestPath,
      '--out', outRoot,
    ], { cwd: process.cwd(), stdio: 'pipe', windowsHide: true })).toThrow();
    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    expect(summary.sampleCount).toBe(0);
    expect(summary.manifest.valid).toBe(false);
    expect(summary.manifest.validationErrors).toEqual(expect.arrayContaining([
      'requestedSampleCount_mismatch:2!=1',
      'sampleSelectionHash_mismatch',
    ]));
    expect(summary.acceptance.status).toBe('FAIL');
    expect(summary.acceptance.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manifest.exactResolve', pass: false }),
      expect.objectContaining({ id: 'sampleCount.exact', pass: false }),
    ]));
  });


  it('records unreadable transcript-tree junctions as skipped inputs instead of aborting collection', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-junction-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: keep real transcript collection resilient to broken junctions.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: skip unreadable junction entries and record them in the inventory.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: rerun the eval runner with the default transcript root.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: scripts/context-compression-eval-runner.mjs junction ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
    symlinkSync(
      join(transcriptRoot, 'missing-target'),
      join(transcriptRoot, 'dangling-junction'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    execFileSync(process.execPath, [
      'scripts/context-compression-eval-runner.mjs',
      '--target', process.cwd(),
      '--samples', '1',
      '--suite', 'daily',
      '--sample-source', 'real',
      '--transcript-root', transcriptRoot,
      '--turn-cohorts', '50',
      '--pressure-cohorts', '0.60',
      '--no-cache',
      '--out', outRoot,
    ], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    expect(summary.sampleCount).toBe(1);
    expect(summary.realInventory.filesFound).toBe(1);
    expect(summary.realInventory.skippedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'unreadable_path',
        code: 'ENOENT',
        path: expect.stringContaining('dangling-junction'),
      }),
    ]));
  });

  it('records and groups all six fixed cohort dimensions and replay metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-six-cohorts-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    const manifestPath = join(root, 'manifest.json');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'model_change', id: 'mc', parentId: null, provider: 'deepseek', modelId: 'deepseek-v4-flash' },
      { type: 'branch_summary', id: 'previous', summary: 'Previous compaction summary: keep the existing runner and avoid a parallel benchmark.' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: fix scripts/context-compression-eval-runner.mjs without creating a second context store.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: keep transcript, archive, file hunk, and CVK selector as the only recoverable evidence anchors.' } },
      { type: 'truncate', id: 'split', content: 'resend split marker' },
      { type: 'message', id: 't', message: { role: 'tool', content: 'Exit code: 0\npnpm exec vitest run tests/unit/context-compression-eval.test.ts passed.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: edit scripts/context-compression-eval-runner.mjs and rerun the focused test.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: scripts/context-compression-eval-runner.mjs fixed-cohort ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    execFileSync(process.execPath, [
      'scripts/context-compression-eval-runner.mjs',
      '--target', process.cwd(),
      '--samples', '1',
      '--suite', 'daily',
      '--sample-source', 'real',
      '--transcript-root', transcriptRoot,
      '--turn-cohorts', '50',
      '--pressure-cohorts', '0.60',
      '--no-cache',
      '--write-sample-manifest', manifestPath,
      '--out', outRoot,
    ], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    const sample = JSON.parse(readFileSync(join(latestRun, 'samples.jsonl'), 'utf8').trim());
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(sample.config).toMatchObject({
      providerCohort: 'deepseek',
      splitTurnCohort: 'split',
      previousSummaryCohort: 'with-previous-summary',
      fileHunkCohort: 'with-file-hunk',
    });
    expect(summary.cohorts.byProvider).toHaveProperty('deepseek');
    expect(summary.cohorts.bySplitTurn).toHaveProperty('split');
    expect(summary.cohorts.byPreviousSummary).toHaveProperty('with-previous-summary');
    expect(summary.cohorts.byFileHunk).toHaveProperty('with-file-hunk');
    expect(summary.cohortBreakdown.byProvider).toHaveProperty('deepseek');
    expect(summary.reproducibility.manifestDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(summary.reproducibility.runParameters).toMatchObject({
      suite: 'daily',
      sampleSource: 'real',
      requestedSampleCount: 1,
      cacheEnabled: false,
    });
    expect(summary.realInventory.inventoryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.version).toBe(2);
    expect(manifest.samples[0].cohort).toMatchObject({
      turn: 50,
      pressure: '0.6',
      provider: 'deepseek',
      splitTurn: 'split',
      previousSummary: 'with-previous-summary',
      fileHunk: 'with-file-hunk',
    });
  });

  it('applies the P0 hard gates and reports min plus 95% confidence intervals', () => {
    const { summary, report } = runRealContextEval('p0-hard-gates', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: apply the P0 hard gates to the compression eval runner.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: critical recall, schema-free omission, and real continuation are hard gates; compression ratio is advisory only.' } },
      { type: 'message', id: 't', message: { role: 'tool', content: 'Exit code: 0\npnpm exec vitest run tests/unit/context-compression-eval.test.ts passed.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: edit scripts/context-compression-eval-runner.mjs and rerun the focused test.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: scripts/context-compression-eval-runner.mjs hard gate ballast.` },
      })),
    ]);

    expect(summary.layer1Gate.thresholds).toMatchObject({
      recallCriticalMean: '>= 0.95',
      recallCriticalMin: '= 1.0',
      criticalDroppedSamples: '= 0',
      recallImportantMean: '>= 0.85',
      weightedRecallMean: '>= 0.90',
      forbiddenFoundTotal: '= 0',
    });
    expect(summary.layer1Gate.thresholds.compressionRatioMean).toBeUndefined();
    expect(summary.layer1.recallCriticalMin).toBe(1);
    expect(summary.layer1.criticalDroppedSamples).toBe(0);
    expect(summary.layer1.confidenceIntervals.recallCritical).toMatchObject({ n: 1, lower: 1, upper: 1 });
    expect(summary.layer3Gate.thresholds).toMatchObject({
      firstActionMatchRate: '>= 0.95',
      criticalActionMatchRate: '>= 0.95',
      noRepeatedWorkRate: '>= 0.98',
      noContradictoryActionRate: '= 1.0',
      taskCompletionDelta: '<= 0.08',
    });
    expect(summary.layer3.confidenceIntervals.firstActionMatch).toMatchObject({ n: 1, lower: 1, upper: 1 });
    expect(summary.layer3Gate).toMatchObject({
      evidenceMode: 'deterministic_proxy',
      executed: false,
      evidenceInsufficient: true,
      diagnosticPass: true,
      pass: false,
    });
    expect(summary.qualityGateRows.filter((row: { layer: string }) => row.layer === 'L3-PROXY').every((row: { gate: string }) => row.gate === 'NOT EXECUTED')).toBe(true);
    expect(report).toContain('95% CI');
    expect(report).toContain('compression=');
    expect(report).toContain('advisory');
    expect(report).toContain('NOT EXECUTED (proxy diagnostics: PASS)');
    expect(summary.acceptance.evidenceInsufficient).toBe(true);
    expect(summary.acceptance.status).toBe('PASS');
  });

  it('fails closed when real continuation is requested but cannot execute', () => {
    const { summary, report } = runRealContextEval('continuation-not-executed', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: require real continuation evidence.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: deterministic continuation remains diagnostic only.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: report the missing real continuation as not executed.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: continuation evidence ballast.` },
      })),
    ], ['--llm-continuation'], {
      COMPACTION_API_KEY: '',
      DEEPSEEK_API_KEY: '',
    });

    expect(summary.llmContinuation).toMatchObject({
      requested: true,
      executed: false,
      gate: {
        status: 'NOT_EXECUTED',
        pass: false,
        evidenceInsufficient: true,
      },
    });
    expect(summary.qualityGateRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layer: 'L3-LLM',
        metric: 'real continuation critical action',
        gate: 'NOT EXECUTED',
      }),
    ]));
    expect(summary.acceptance).toMatchObject({ status: 'FAIL', evidenceInsufficient: true });
    expect(summary.acceptance.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'l3.realContinuation.executed', pass: false }),
      expect.objectContaining({ id: 'l3.realContinuation.gate', pass: false }),
    ]));
    expect(report).toContain('- Evidence insufficient: yes');
    expect(report).toContain('| L3 LLM Continuation | not executed | NOT EXECUTED |');
  });

  it('retries empty continuation protocol output and repairs a truncated JSON response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-real-continuation-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: require sufficient real continuation evidence.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: deterministic continuation remains diagnostic only.' } },
      { type: 'message', id: 't', message: { role: 'tool', content: 'Exit code: 0\npnpm exec vitest run tests/unit/context-compression-eval.test.ts passed.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: preserve the passing validation and report sufficient evidence.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: real continuation evidence ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    const serverScript = String.raw`
      const http = require('node:http');
      let requestCount = 0;
      const server = http.createServer((request, response) => {
        let body = '';
        requestCount += 1;
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
          const payload = JSON.parse(body);
          const prompt = payload.messages.at(-1).content;
          const candidateJson = prompt.split('## Candidate Actions\n')[1].split('\n\nRules:')[0];
          const actions = JSON.parse(candidateJson).filter((action) => !action.id.includes('-distractor-'));
          response.writeHead(200, { 'content-type': 'application/json' });
          const valid = JSON.stringify({ actions, completed: true, rationale: 'local fixture retry' });
          const content = requestCount === 1
            ? JSON.stringify({ actions: [], completed: true, rationale: 'empty protocol response' })
            : requestCount === 2
              ? valid.slice(0, -1)
              : JSON.stringify({ actions: [], completed: true, rationale: 'empty protocol response again' });
          response.end(JSON.stringify({
            choices: [{ message: { content } }],
          }));
        });
      });
      server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\n'));
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `;
    const server = spawn(process.execPath, ['-e', serverScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      let output = '';
      server.stdout.setEncoding('utf8');
      server.stdout.on('data', (chunk: string) => {
        output += chunk;
        const line = output.split(/\r?\n/u)[0];
        if (/^\d+$/u.test(line)) resolvePort(Number(line));
      });
      server.once('error', rejectPort);
      server.once('exit', (code) => rejectPort(new Error(`Continuation fixture exited before listening: ${code}`)));
    });

    try {
      execFileSync(process.execPath, [
        'scripts/context-compression-eval-runner.mjs',
        '--target', process.cwd(),
        '--samples', '1',
        '--suite', 'daily',
        '--sample-source', 'real',
        '--transcript-root', transcriptRoot,
        '--turn-cohorts', '50',
        '--pressure-cohorts', '0.60',
        '--llm-continuation',
        '--continuation-samples', '1',
        '--no-cache',
        '--out', outRoot,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          COMPACTION_PROVIDER: 'local-fixture',
          COMPACTION_BASE_URL: `http://127.0.0.1:${port}/v1`,
          COMPACTION_API_KEY: 'local-fixture-key',
          DEEPSEEK_API_KEY: '',
        },
        stdio: 'pipe',
        windowsHide: true,
      });

      const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
      const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
      const report = readFileSync(join(latestRun, 'report.md'), 'utf8');
      expect(summary.layer3Gate).toMatchObject({ executed: false, evidenceInsufficient: true });
      expect(summary.llmContinuation).toMatchObject({
        requested: true,
        executed: true,
        liveCount: 1,
        gate: { executed: true, pass: true, evidenceInsufficient: false },
      });
      expect(summary.llmContinuation.results[0]).toMatchObject({
        protocolRetryUsed: true,
        evaluation: { criticalActionMatch: true },
      });
      expect(report).toContain('real continuation');

      const emptyRetryRoot = join(root, 'out-empty-retry');
      try {
        execFileSync(process.execPath, [
          'scripts/context-compression-eval-runner.mjs',
          '--target', process.cwd(),
          '--samples', '1',
          '--suite', 'daily',
          '--sample-source', 'real',
          '--transcript-root', transcriptRoot,
          '--turn-cohorts', '50',
          '--pressure-cohorts', '0.60',
          '--llm-continuation',
          '--continuation-samples', '1',
          '--no-cache',
          '--out', emptyRetryRoot,
        ], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            COMPACTION_PROVIDER: 'local-fixture',
            COMPACTION_BASE_URL: `http://127.0.0.1:${port}/v1`,
            COMPACTION_API_KEY: 'local-fixture-key',
            DEEPSEEK_API_KEY: '',
          },
          stdio: 'pipe',
          windowsHide: true,
        });
      } catch (error) {
        if (!existsSync(join(emptyRetryRoot, 'latest-run.txt'))) throw error;
      }

      const emptyLatestRun = readFileSync(join(emptyRetryRoot, 'latest-run.txt'), 'utf8');
      const emptySummary = JSON.parse(readFileSync(join(emptyLatestRun, 'summary.json'), 'utf8'));
      expect(emptySummary.acceptance.status).toBe('FAIL');
      expect(emptySummary.llmContinuation.results[0]).toMatchObject({
        actions: [],
        protocolRetryUsed: true,
        evaluation: { criticalActionMatch: false },
      });
    } finally {
      server.kill();
    }
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('fails full mode when the real cohort is below the configured minimum', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-full-real-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: require full real gate.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: full mode needs enough real samples.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: report FAIL when real coverage is too small.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: tests/unit/context-compression-eval.test.ts` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    expect(() => execFileSync(process.execPath, [
      'scripts/context-compression-eval-runner.mjs',
      '--target', process.cwd(),
      '--samples', '1',
      '--suite', 'full',
      '--sample-source', 'real',
      '--transcript-root', transcriptRoot,
      '--turn-cohorts', '50',
      '--pressure-cohorts', '0.60',
      '--full-real-min', '100',
      '--out', outRoot,
    ], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    })).toThrow();

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    expect(summary.acceptance.status).toBe('FAIL');
    expect(summary.acceptance.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'full.realMinCount', pass: false }),
      expect.objectContaining({ id: 'full.fixedManifest', pass: false }),
      expect.objectContaining({ id: 'full.realContinuation.requested', pass: false }),
      expect.objectContaining({ id: 'full.realContinuation.coverage', pass: false }),
      expect.objectContaining({ id: 'full.realJudge.requested', pass: false }),
      expect.objectContaining({ id: 'full.realJudge.coverage', pass: false }),
      expect.objectContaining({ id: 'full.schemaFree.requested', pass: false }),
      expect.objectContaining({ id: 'full.schemaFree.coverage', pass: false }),
      expect.objectContaining({ id: 'full.modelIndependence', pass: false }),
      expect.objectContaining({ id: 'full.noCache', pass: false }),
    ]));
  });

  it('parses Codex archived payload transcripts while filtering harness noise', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-codex-archive-'));
    const transcriptRoot = join(root, 'archived');
    const outRoot = join(root, 'out');
    const transcriptPath = join(transcriptRoot, 'rollout.jsonl');
    mkdirSync(transcriptRoot, { recursive: true });
    const lines = [
      { type: 'session_meta', payload: { cwd: 'C:\\Users\\alice\\workspace\\demo' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'dev-noise',
          message: {
            role: 'developer',
            content: [{ type: 'text', text: '<permissions instructions>Do not treat this as task evidence.</permissions instructions>' }],
          },
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'user-objective',
          message: {
            role: 'user',
            content: [{ type: 'input_text', text: '请修复 context compression runner：必须保留真实 next action，并且不要泄露 authorization: Bearer live-secret-token.' }],
          },
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'assistant-decision',
          message: {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Decision: use the existing L0-L3 runner and edit scripts/context-compression-eval-runner.mjs instead of creating a parallel benchmark.' }],
          },
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          id: 'tool-output',
          output: 'Exit code: 1\npnpm exec vitest run tests/unit/context-compression-eval.test.ts failed because archived payload parsing was missing.',
        },
      },
      {
        type: 'branch_summary',
        payload: {
          id: 'old-branch',
          summary: 'STALE decision: replace the L0-L3 runner with a brand new benchmark.',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'assistant-next',
          message: {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Next action: rerun pnpm exec vitest run tests/unit/context-compression-eval.test.ts and inspect the generated report.' }],
          },
        },
      },
      ...Array.from({ length: 120 }, (_, index) => ({
        type: 'response_item',
        payload: {
          type: 'message',
          id: `assistant-context-${index}`,
          message: {
            role: 'assistant',
            content: [{ type: 'output_text', text: `Evidence note ${index}: keep scripts/context-compression-eval-runner.mjs tied to report line ${index}.` }],
          },
        },
      })),
    ];
    writeFileSync(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    execFileSync(process.execPath, [
      'scripts/context-compression-eval-runner.mjs',
      '--target',
      process.cwd(),
      '--samples',
      '1',
      '--suite',
      'daily',
      '--sample-source',
      'real',
      '--transcript-root',
      transcriptRoot,
      '--turn-cohorts',
      '200',
      '--pressure-cohorts',
      '0.60',
      '--cache-dir',
      join(root, 'cache'),
      '--out',
      outRoot,
    ], {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    });

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    const samplesJsonl = readFileSync(join(latestRun, 'samples.jsonl'), 'utf8');
    const report = readFileSync(join(latestRun, 'report.md'), 'utf8');

    expect(summary.sampleCount).toBe(1);
    expect(summary.realInventory.entriesParsed).toBeGreaterThan(0);
    expect(summary.redactionSummary.replacements.authHeaders + summary.redactionSummary.replacements.authTokens).toBeGreaterThan(0);
    expect(samplesJsonl).toContain('user-objective');
    expect(samplesJsonl).not.toContain('dev-noise');
    expect(report).not.toMatch(/Bearer\s+live-secret-token/iu);
    expect(report).not.toMatch(/\bauthorization\s*[:=]/iu);
    expect(summary.acceptance.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sampleCount.exact', pass: true }),
      expect.objectContaining({ id: 'samplesJsonl.exact', pass: true }),
    ]));
  });
});

describe('P4 paired trajectory and model cascade helpers', () => {
  const row = (overrides: Partial<PairedTrajectoryRow> = {}): PairedTrajectoryRow => ({
    sampleId: 'S1',
    compressedSummary: 'compressed',
    fullContextSuccess: true,
    compressedSuccess: false,
    ...overrides,
  });

  it('classifies only full-context success plus compressed failure as compression-induced failure', () => {
    expect(classifyPairedTrajectory(row())).toBe('compression_induced_failure');
    expect(classifyPairedTrajectory(row({ fullContextSuccess: false, compressedSuccess: false }))).toBe('preexisting_failure');
    expect(classifyPairedTrajectory(row({ fullContextSuccess: true, compressedSuccess: true }))).toBe('compressed_success');
    expect(classifyPairedTrajectory(row({ fullContextSuccess: false, compressedSuccess: true }))).toBe('preexisting_failure');
    expect(classifyPairedTrajectory(row({ fullContextSuccess: true, compressedSuccess: false, failureKind: 'stale_branch' }))).toBe('compression_induced_failure');
  });

  it('requires the compressor model to differ from every configured evaluation model', () => {
    const blocked = assertModelIndependence({
      compressorModel: 'deepseek-chat',
      judgeModel: 'deepseek-chat',
      schemaFreeModel: 'deepseek-chat',
      continuationModel: 'deepseek-chat',
      criticModel: 'deepseek-chat',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain('reused by an evaluation stage');

    const missingEvaluation = assertModelIndependence({
      compressorModel: 'deepseek-chat',
    });
    expect(missingEvaluation.ok).toBe(false);
    expect(missingEvaluation.reason).toContain('Missing explicit judge');

    const independent = assertModelIndependence({
      compressorModel: 'deepseek-chat',
      judgeModel: 'deepseek-reasoner',
      schemaFreeModel: 'deepseek-reasoner',
      continuationModel: 'deepseek-reasoner',
      criticModel: 'deepseek-reasoner',
    });
    expect(independent.ok).toBe(true);
    expect(independent).toMatchObject({
      compressorModel: 'deepseek-chat',
      judgeModel: 'deepseek-reasoner',
      schemaFreeModel: 'deepseek-reasoner',
      continuationModel: 'deepseek-reasoner',
      criticModel: 'deepseek-reasoner',
    });
  });

  it('builds bounded failure guidelines from compression-induced failures only', () => {
    const guidelines = buildFailureGuidelines({
      generatedAt: '2026-08-17T00:00:00.000Z',
      maxAtoms: 2,
      rows: [
        row({ sampleId: 'S1', failureKind: 'omitted_blocker' }),
        row({ sampleId: 'S2', fullContextSuccess: false, compressedSuccess: false }),
        row({ sampleId: 'S3', fullContextSuccess: true, compressedSuccess: true }),
        row({ sampleId: 'S4', failureKind: 'omitted_blocker' }),
      ],
      criticResults: [
        {
          sampleId: 'S1',
          model: 'deepseek-chat',
          promptVersion: 'critic-v1',
          missingAtoms: [
            { canonicalIdentity: 'goal:blocker', type: 'goal', severity: 'critical', rationale: 'Keep the blocker.' },
          ],
          repairGuideline: 'Preserve blocker before next action.',
        },
        {
          sampleId: 'S2',
          model: 'deepseek-chat',
          promptVersion: 'critic-v1',
          missingAtoms: [
            { canonicalIdentity: 'goal:preexisting', type: 'goal', severity: 'critical', rationale: 'Should not appear.' },
          ],
          repairGuideline: 'Preexisting failure is not compression-induced.',
        },
        {
          sampleId: 'S3',
          model: 'deepseek-chat',
          promptVersion: 'critic-v1',
          missingAtoms: [
            { canonicalIdentity: 'goal:success', type: 'goal', severity: 'critical', rationale: 'Should not appear.' },
          ],
          repairGuideline: 'Compressed success is not damage.',
        },
        {
          sampleId: 'S4',
          model: 'deepseek-chat',
          promptVersion: 'critic-v1',
          missingAtoms: [
            { canonicalIdentity: 'goal:blocker', type: 'goal', severity: 'critical', rationale: 'Keep the blocker.' },
          ],
          repairGuideline: 'Preserve blocker before next action.',
        },
      ],
    });

    expect(guidelines.version).toBe(1);
    expect(guidelines.atomLimit).toBe(2);
    expect(guidelines.guidelines).toHaveLength(1);
    expect(guidelines.guidelines[0]).toMatchObject({
      canonicalIdentity: 'goal:blocker',
      count: 2,
      sampleIds: ['S1', 'S4'],
    });
    expect(guidelines.guidelines[0]?.sampleIds).not.toContain('S2');
    expect(guidelines.guidelines[0]?.sampleIds).not.toContain('S3');
  });

  it('summarizes paired trajectory metrics without dividing by empty cohorts', () => {
    const metrics = summarizePairedTrajectoryMetrics({
      rows: [
        row({ sampleId: 'S1', retryCount: 2, latencyMs: 4200, tokenUsage: { input: 8000, output: 600 }, cost: { input: 0.004, output: 0.001 } }),
        row({ sampleId: 'S2', fullContextSuccess: false, compressedSuccess: false }),
      ],
      criticResults: [{ sampleId: 'S1', model: 'deepseek-chat', promptVersion: 'critic-v1', missingAtoms: [], repairGuideline: '' }],
    });

    expect(metrics.sampleCount).toBe(2);
    expect(metrics.compressionInducedFailureCount).toBe(1);
    expect(metrics.preexistingFailureCount).toBe(1);
    expect(metrics.retryRate).toBe(0.5);
    expect(metrics.latency.mean).toBe(4200);
    expect(metrics.tokens.inputMean).toBe(8000);
    expect(metrics.tokens.outputMean).toBe(600);
    expect(metrics.cost.mean).toBeCloseTo(0.005, 6);
    expect(metrics.criticCoverage).toEqual({ matchedFailures: 1, totalFailures: 1, rate: 1 });
  });
});

  it('runs the eval runner with --paired-trajectory and writes failure guidelines', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-compression-p4-trajectory-'));
    const transcriptRoot = join(root, 'sessions');
    const outRoot = join(root, 'out');
    const trajectoryPath = join(root, 'trajectory.jsonl');
    const guidelinesPath = join(root, 'guidelines.json');
    mkdirSync(transcriptRoot, { recursive: true });
    writeFileSync(join(transcriptRoot, 'session.jsonl'), `${[
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: preserve the critical blocker in the compressed context.' } },
      { type: 'message', id: 'a', message: { role: 'assistant', content: 'Decision: keep the missing selector explicit and never trust a stale branch.' } },
      { type: 'message', id: 't', message: { role: 'tool', content: 'Exit code: 0\npnpm exec vitest run tests/unit/context-compression-eval.test.ts passed.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: rerun the focused P4 trajectory test.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: paired trajectory runner ballast.` },
      })),
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
    writeFileSync(trajectoryPath, `${[
      { sampleId: 'R1', compressedSummary: 'Compressed context omits the critical blocker.', fullContextSuccess: true, compressedSuccess: false, failureKind: 'omitted_blocker', compressorModel: 'deepseek-chat', retryCount: 1, latencyMs: 4200, tokenUsage: { input: 8000, output: 600 }, cost: { input: 0.004, output: 0.001 } },
      { compressedSummary: 'missing sample id row' },
    ].map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    try {
      execFileSync(process.execPath, [
        'scripts/context-compression-eval-runner.mjs',
        '--target', process.cwd(),
        '--samples', '1',
        '--suite', 'daily',
        '--sample-source', 'real',
        '--transcript-root', transcriptRoot,
        '--turn-cohorts', '50',
        '--pressure-cohorts', '0.60',
        '--no-cache',
        '--paired-trajectory', trajectoryPath,
        '--write-failure-guidelines', guidelinesPath,
        '--out', outRoot,
      ], {
        cwd: process.cwd(),
        stdio: 'pipe',
        windowsHide: true,
      });
    } catch (error) {
      if (!existsSync(join(outRoot, 'latest-run.txt'))) throw error;
    }

    const latestRun = readFileSync(join(outRoot, 'latest-run.txt'), 'utf8');
    const summary = JSON.parse(readFileSync(join(latestRun, 'summary.json'), 'utf8'));
    const report = readFileSync(join(latestRun, 'report.md'), 'utf8');

    expect(summary.pairedTrajectory.requested).toBe(true);
    expect(summary.pairedTrajectory.executed).toBe(true);
    expect(summary.pairedTrajectory.sampleCount).toBe(1);
    expect(summary.pairedTrajectory.classification).toMatchObject({
      compressionInducedFailure: 1,
      preexistingFailure: 0,
      compressedSuccess: 0,
      indeterminate: 0,
    });
    expect(summary.pairedTrajectory.invalidRows).toEqual([
      expect.objectContaining({ reason: 'missing_required_fields' }),
    ]);
    expect(summary.pairedTrajectory.metrics.retryRate).toBe(1);
    expect(summary.pairedTrajectory.metrics.latency.mean).toBe(4200);
    expect(summary.pairedTrajectory.modelIndependence.ok).toBe(false);
    expect(summary.failureGuidelines.guidelines).toEqual([]);
    expect(report).toContain('Paired trajectory');
    expect(report).toContain('NOT OK');
    expect(existsSync(guidelinesPath)).toBe(true);
  });

describe('P6 grounded extractor (v8 Phase 1): provenance verifier and conservative merge', () => {
  // Imported lazily so the suite does not pay ESM graph cost unless reached.
  const loadExtractor = async () => import('../../scripts/context-compression-grounded-extractor.mjs');

  const fakeWindow = async () => {
    const { buildExtractionWindow } = await loadExtractor();
    return buildExtractionWindow({
      entries: [
        { messageId: 'm1', line: 5, role: 'assistant', kind: 'text', text: 'The deploy failed with error E-123 at 10:00. Retrying is not advised.' },
        { messageId: 'm2', line: 9, role: 'toolResult', kind: 'tool_result', text: 'verify_tests: skipped(no-manifest): no test suite was run.' },
      ],
    });
  };

  it('rejects a candidate whose quote is not a verbatim substring (tampered quote)', async () => {
    const { verifyCandidateFact } = await loadExtractor();
    const window = await fakeWindow();
    const verdict = verifyCandidateFact({
      text: 'deploy failed with a different error',
      provenance: { entryId: 'm1', quote: 'error E-999 at 10:00' },
    }, window);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('quote_not_verbatim');
  });

  it('rejects a candidate without a usable quote (fail-closed)', async () => {
    const { verifyCandidateFact } = await loadExtractor();
    const window = await fakeWindow();
    expect(verifyCandidateFact({ text: 'x', provenance: { entryId: 'm1' } }, window).ok).toBe(false);
    expect(verifyCandidateFact({ text: 'x', provenance: { entryId: 'm1', quote: 'short' } }, window).reason).toBe('missing_or_short_quote');
  });

  it('rejects a candidate whose entryId does not resolve inside the window', async () => {
    const { verifyCandidateFact } = await loadExtractor();
    const window = await fakeWindow();
    const verdict = verifyCandidateFact({
      text: 'deploy failed',
      provenance: { entryId: 'zz-not-in-window', quote: 'The deploy failed with error E-123' },
    }, window);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('entry_not_in_window');
  });

  it('accepts a verbatim quote with resolvable entry and out-of-range line guard', async () => {
    const { verifyCandidateFact } = await loadExtractor();
    const window = await fakeWindow();
    const ok = verifyCandidateFact({
      text: 'deploy failed with E-123',
      provenance: { entryId: 'm1', quote: 'The deploy failed with error E-123' },
    }, window);
    expect(ok.ok).toBe(true);
    expect(ok.entry.line).toBe(5);
    const badLine = verifyCandidateFact({
      text: 'deploy failed with E-123',
      provenance: { entryId: 'm1', quote: 'The deploy failed with error E-123', lineStart: 999 },
    }, window);
    expect(badLine.ok).toBe(false);
    expect(badLine.reason).toBe('line_out_of_range');
  });

  it('resolves polarity conflicts conservatively (pending beats LLM completion) and caps llm-only severity', async () => {
    const { mergeFactPools } = await loadExtractor();
    const regexFacts = [{
      id: 'R1-pending-objective',
      text: 'Objective not verified complete in its own task segment: manual compaction was not executed',
      severity: 'important',
      category: 'decision',
      evidence: { messageId: 'obj', line: 1 },
    }];
    const verifiedLlmFacts = [
      {
        text: 'Manual compaction task completed and verified successfully',
        category: 'decision',
        severity: 'critical',
        provenance: { entryId: 'm1', quote: 'completed and verified', line: 5 },
      },
      {
        text: 'verify_tests skipped because no project manifest was found',
        category: 'test_result',
        severity: 'critical',
        provenance: { entryId: 'm2', quote: 'no test suite was run', line: 9 },
      },
    ];
    const result = mergeFactPools({ regexFacts, verifiedLlmFacts, sampleId: 'R1' });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('kept_regex_conservative');
    // The conflicting completion claim must NOT enter the merged pool.
    expect(result.mergedFacts.some((fact: any) => /completed and verified/i.test(fact.text))).toBe(false);
    // The pending regex fact survives untouched.
    expect(result.mergedFacts.some((fact: any) => fact.id === 'R1-pending-objective')).toBe(true);
    // The llm-only fact is kept but capped from critical to important.
    const llmOnly = result.mergedFacts.find((fact: any) => fact.extractorAgreement === 'llm-only');
    expect(llmOnly?.severity).toBe('important');
    expect(result.llmOnlyCount).toBe(1);
  });

  it('reinforces matching regex facts with provenance instead of duplicating them', async () => {
    const { mergeFactPools } = await loadExtractor();
    const regexFacts = [{
      id: 'R2-test-skip',
      text: 'verify_tests: skipped(no-manifest): no test suite was run',
      severity: 'important',
      category: 'test_result',
      evidence: { messageId: 'm2', line: 9 },
    }];
    const verifiedLlmFacts = [{
      text: 'verify_tests skipped(no-manifest): no test suite was run',
      category: 'test_result',
      severity: 'important',
      provenance: { entryId: 'm2', quote: 'no test suite was run', line: 9 },
    }];
    const result = mergeFactPools({ regexFacts, verifiedLlmFacts, sampleId: 'R2' });
    expect(result.bothCount).toBe(1);
    expect(result.llmOnlyCount).toBe(0);
    expect(result.mergedFacts).toHaveLength(1);
    expect(result.mergedFacts[0].extractorAgreement).toBe('both');
    expect(result.mergedFacts[0].provenance?.entryId).toBe('m2');
  });

  it('never exceeds the chunk budget and covers every entry', async () => {
    const { buildExtractionWindow, chunkWindow } = await loadExtractor();
    const entries = Array.from({ length: 60 }, (_, index) => ({
      messageId: `e${index}`,
      line: index + 1,
      role: 'assistant',
      kind: 'text',
      text: `entry body ${index} ${'x'.repeat(900)}`,
    }));
    const window = buildExtractionWindow({ entries });
    const chunks = chunkWindow(window, { maxChunks: 12 });
    expect(chunks.length).toBeLessThanOrEqual(12);
    const joined = chunks.join('\n');
    for (let index = 0; index < 60; index += 1) {
      expect(joined).toContain(`[entry e${index} `);
    }
  });
});
describe('P6 v8 round-3 mechanisms: story scoping and regression-aware attribution', () => {
  const loadExtractor = async () => import('../../scripts/context-compression-grounded-extractor.mjs');
  const loadLoop = async () => import('../../scripts/context-compression-optimization-loop.mjs');

  const fact = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
    id, text, severity: 'critical', category: 'decision', acceptableParaphrases: [],
    evidence: { messageId: 'm', line: 1, file: 'f' }, ...extra,
  });

  it('classifyStory: pending-objective wins over failures and outcomes', async () => {
    const { classifyStory } = await loadExtractor();
    expect(classifyStory({ expected: [fact('R1-pending-objective', 'Objective not verified complete')] })).toBe('pending');
    expect(classifyStory({ expected: [
      fact('R1-pending-objective', 'Objective not verified complete'),
      fact('R1-latest-outcome', 'Task completed and verified'),
    ] })).toBe('pending');
  });

  it('classifyStory: unresolved failure without outcome is blocked; otherwise completed', async () => {
    const { classifyStory } = await loadExtractor();
    const unresolved = fact('R1-failure-chain-1', 'Failure chain', {
      failureSummary: { classification: 'environment_or_invocation_failure', resolved: false, followUp: 'Fix the environment' },
    });
    expect(classifyStory({ expected: [unresolved] })).toBe('blocked');
    expect(classifyStory({ expected: [unresolved, fact('R1-latest-outcome', 'Fixed and confirmed')] })).toBe('completed');
    expect(classifyStory({ expected: [fact('R1-latest-outcome', 'Fixed and confirmed')] })).toBe('completed');
  });

  it('activeRows: plain strings always apply; object rows respect story scope', async () => {
    const { activeRows } = await loadLoop();
    const section = [
      'global rule',
      { line: 'completed-only rule', scope: 'completed' },
      { line: 'pending-only rule', scope: 'pending' },
      { line: 'another global', scope: 'always' },
    ];
    expect(activeRows(section, 'completed')).toEqual(['global rule', 'completed-only rule', 'another global']);
    expect(activeRows(section, 'pending')).toEqual(['global rule', 'pending-only rule', 'another global']);
    expect(activeRows(section, 'blocked')).toEqual(['global rule', 'another global']);
    expect(activeRows(undefined, 'pending')).toEqual([]);
  });

  it('applyPatches: scoped rows are validated and duplicates rejected', async () => {
    const { applyPatches } = await loadLoop();
    const base = { id: 'v0', extractorFocus: ['base rule'], generationDirectives: [] };
    const patches = [
      { target: 'generationDirectives', op: 'add', line: 'VERIFIED presentation', scope: 'completed', rationale: 'r' },
      { target: 'generationDirectives', op: 'add', line: 'VERIFIED presentation', scope: 'completed', rationale: 'dup' },
      { target: 'generationDirectives', op: 'add', line: 'bad scope', scope: 'sometimes', rationale: 'invalid scope must be rejected' },
      { target: 'extractorFocus', op: 'add', line: 'extract pending items verbatim', scope: 'pending', rationale: 'r' },
    ];
    const next = applyPatches({ baseGuideline: base, patches, round: 9 });
    expect(next.schema).toBe('compact-guideline/v2');
    expect(next.generationDirectives).toEqual([{ line: 'VERIFIED presentation', scope: 'completed' }]);
    expect(next.extractorFocus).toContainEqual({ line: 'extract pending items verbatim', scope: 'pending' });
    const reasons = next.patchLog.map((entry: any) => entry.reason);
    expect(reasons).toContain('duplicate_line');
    expect(reasons.filter((reason: string) => reason === 'invalid_patch_shape').length).toBeGreaterThanOrEqual(1);
  });

  it('regressionFlips: detects success-lost / repeat-gained / contradiction-gained only', async () => {
    const { regressionFlips } = await loadLoop();
    const baseline = { results: [
      { sampleId: 'A', success: true, repeat: false, contradiction: false },
      { sampleId: 'B', success: false, repeat: false, contradiction: false },
      { sampleId: 'C', success: false, repeat: true, contradiction: false },
    ] };
    const candidate = { results: [
      { sampleId: 'A', success: false, repeat: false, contradiction: true },
      { sampleId: 'B', success: true, repeat: false, contradiction: false },
      { sampleId: 'C', success: false, repeat: false, contradiction: false },
    ] };
    const flips = regressionFlips(baseline, candidate);
    expect(flips).toHaveLength(1);
    expect(flips[0].sampleId).toBe('A');
    expect(flips[0].kind).toBe('success-lost+contradiction-gained');
  });
});
describe('P6 v8 candidate-v4 enabler: verified next_action facts join the next-action pipeline', () => {
  it('llm-only next_action facts get next-action ids (directive-promotable) with provenance intact', async () => {
    const { mergeFactPools } = await import('../../scripts/context-compression-grounded-extractor.mjs');
    const result = mergeFactPools({
      regexFacts: [{ id: 'R1-objective', text: 'Objective: compress the current session history (trial)', severity: 'critical', category: 'objective', evidence: { messageId: 'o', line: 1 } }],
      verifiedLlmFacts: [{
        text: 'Execute manual compaction via the /compact slash command or the compaction-safeguard path, then report the outcome',
        category: 'next_action',
        severity: 'critical',
        provenance: { entryId: 'm1', quote: 'run /compact to compress', line: 42 },
      }],
      sampleId: 'R1',
    });
    const nextActionFact = result.mergedFacts.find((fact: any) => String(fact.id).includes('next-action'));
    expect(nextActionFact).toBeTruthy();
    expect(nextActionFact?.extractorAgreement).toBe('llm-only');
    expect(nextActionFact?.severity).toBe('important');
    expect(nextActionFact?.provenance?.quote).toBe('run /compact to compress');
  });
});
describe('P6 v8 directive fix: active-segment next action and concrete-over-followUp', () => {
  const loadLedger = async () => import('../../scripts/context-compression-recovery-ledger.mjs');

  it('stale earlier-task next actions do not dictate continuation (R17 root cause)', async () => {
    const { buildContinuationDirective } = await loadLedger();
    const directive = buildContinuationDirective({
      sampleId: 'R17',
      objectiveSegmentEndLine: 240,
      expected: [
        { id: 'R17-next-action', text: 'stale: read any java file and summarize it', severity: 'critical', category: 'decision', evidence: { messageId: 'a', line: 30, file: 'f' } },
        { id: 'R17-pending-objective', text: 'manual compaction not executed', severity: 'important', category: 'decision', evidence: { messageId: 'b', line: 159, file: 'f' } },
        { id: 'R17-next-action-llm-1', text: 'execute compaction via /compact or compaction-safeguard', severity: 'important', category: 'decision', evidence: { messageId: 'c', line: 200, file: 'f' }, provenance: { entryId: 'c', quote: 'run /compact', line: 200 } },
      ],
    });
    expect(directive.text).toContain('/compact');
    expect(directive.text).not.toContain('read any java file');
  });

  it('concrete provenance-verified next action outranks generic failure followUp (R9/R30 root cause)', async () => {
    const { buildContinuationDirective } = await loadLedger();
    const failure = {
      id: 'R9-failure-chain-1', text: 'gateway broken', severity: 'critical', category: 'blocker',
      evidence: { messageId: 'x', line: 10, file: 'f' },
      failureSummary: { classification: 'environment_or_invocation_failure', resolved: false, followUp: 'Fix the environment or command invocation, then rerun.' },
    };
    const concrete = {
      id: 'R9-next-action-llm-1', text: 'rebuild or reinstall openclaw_runtime dist module io-B86lst6B.js, then rerun',
      severity: 'important', category: 'decision', evidence: { messageId: 'y', line: 18, file: 'f' },
      provenance: { entryId: 'y', quote: 'rebuild the runtime dist', line: 18 },
    };
    const withConcrete = buildContinuationDirective({ sampleId: 'R9', expected: [failure, concrete] });
    expect(withConcrete.text).toContain('openclaw_runtime');
    expect(withConcrete.text).not.toContain('Fix the environment or command invocation');
    // Without provenance the generic followUp must still win (conservative).
    const unverified = { ...concrete, provenance: undefined };
    const withoutProvenance = buildContinuationDirective({ sampleId: 'R9', expected: [failure, unverified] });
    expect(withoutProvenance.text).toContain('Fix the environment or command invocation');
  });
});
describe('P6 v8 extraction stabilization: k-shot majority extraction', () => {
  const loadExtractor = async () => import('../../scripts/context-compression-grounded-extractor.mjs');

  it('majorityMergeFactBallots keeps majority-supported facts and drops singletons', async () => {
    const { majorityMergeFactBallots } = await loadExtractor();
    const mk = (text: string) => ({ text, category: 'decision', severity: 'important', provenance: { entryId: 'm1', quote: text, line: 5 } });
    const ballots = [
      [mk('the gateway is broken due to missing io-B86lst6B.js module'), mk('context usage is 3 percent')],
      [mk('the gateway is broken because io-B86lst6B.js module is missing')],
      [mk('context usage is 3 percent'), mk('singleton fact only in ballot three')],
    ];
    const merged = majorityMergeFactBallots(ballots);
    expect(merged).toHaveLength(2);
    expect(merged.some((fact: any) => /io-B86lst6B/u.test(fact.text))).toBe(true);
    expect(merged.some((fact: any) => /context usage/u.test(fact.text))).toBe(true);
    expect(merged.some((fact: any) => /singleton/u.test(fact.text))).toBe(false);
    // Single ballot passes through untouched.
    expect(majorityMergeFactBallots(ballots.slice(0, 1))).toHaveLength(2);
  });

  it('k-shot extraction: facts supported by 2/3 ballots survive, singletons rejected (offline stub)', async () => {
    const { extractGroundedFacts } = await loadExtractor();
    const windowEntry = { messageId: 'm1', line: 5, role: 'assistant', kind: 'text', text: 'The gateway failed with error E-123 and must be rebuilt. Context usage is 3 percent.' };
    const ledger = { sampleId: 'K1', entries: [windowEntry], expected: [] };
    const quote = 'The gateway failed with error E-123';
    const responses = [
      { facts: [{ text: 'gateway failed with error E-123 and must be rebuilt', category: 'failure', severity: 'important', provenance: { entryId: 'm1', quote } }, { text: 'context usage is 3 percent', category: 'other', severity: 'minor', provenance: { entryId: 'm1', quote: 'Context usage is 3 percent' } }] },
      { facts: [{ text: 'the gateway failed with error E-123 and must be rebuilt', category: 'failure', severity: 'important', provenance: { entryId: 'm1', quote } }] },
      { facts: [{ text: 'a singleton claim appears only once', category: 'other', severity: 'minor', provenance: { entryId: 'm1', quote: 'must be rebuilt' } }] },
    ];
    let call = 0;
    const transport = async () => {
      const payload = responses[call % responses.length];
      call += 1;
      return {
        ok: true, status: 200, headers: { get: () => undefined },
        json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        text: async () => '',
      };
    };
    const result = await extractGroundedFacts({
      ledger, model: 'stub', provider: { baseUrl: 'http://stub', apiKey: 'k' }, transport, votes: 3,
    });
    expect(result.chunks).toBe(1);
    const texts = result.mergedFacts.map((fact: any) => fact.text).join(' | ');
    expect(/E-123/u.test(texts)).toBe(true);
    expect(/singleton/u.test(texts)).toBe(false);
    expect(result.verifiedCount).toBe(1);
  });
});