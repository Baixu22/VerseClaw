// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actionSignature,
  aggregateContinuationEvaluations,
  aggregateFactSetEvaluations,
  assessLayer3Gate,
  assessLayer1Gate,
  buildEvalSampleMatrix,
  buildFaithfulnessJudgePrompt,
  evaluateDeterministicFaithfulness,
  evaluateContinuationScenario,
  evaluateCausalChains,
  evaluateFactSet,
  paraphraseSemanticMatcher,
  type AnnotatedFact,
  type DownstreamAction,
} from './helpers/context-compression-eval';

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
  const runRealContextEval = (name: string, transcriptLines: unknown[], extraArgs: string[] = []) => {
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
      expect.objectContaining({ id: 'weightedRecall.mean', pass: true }),
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
    expect(summary.humanEvaluation.status).toBe('missing_ratings');
    expect(existsSync(join(latestRun, 'human-eval-pack.jsonl'))).toBe(true);
    expect(report).toContain('Hunk A/B');
    expect(report).toContain('Information Loss');
    expect(report).toContain('Degradation Curve');
    expect(report).toContain('Human Evaluation');
  });

  it('imports human evaluation ratings and reports human-auto correlation readiness', () => {
    const ratingsRoot = mkdtempSync(join(tmpdir(), 'context-compression-human-ratings-'));
    const ratingsPath = join(ratingsRoot, 'ratings.jsonl');
    writeFileSync(ratingsPath, [
      JSON.stringify({ sampleId: 'R1', raterId: 'dev-a', score: 5, missingInfoNotes: '', actionabilityNotes: 'clear' }),
      JSON.stringify({ sampleId: 'R1', raterId: 'dev-b', score: 4, missingInfoNotes: 'minor detail missing', actionabilityNotes: 'usable' }),
    ].join('\n') + '\n', 'utf8');

    const { summary, report } = runRealContextEval('human-ratings', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: create a human evaluation import fixture for compressed context quality.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Decision: write human ratings JSONL and compare it against automated context compression scores.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: inspect the humanEvaluation summary and report correlation readiness.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: tests/unit/context-compression-eval.test.ts human eval ballast.` },
      })),
    ], ['--human-eval-ratings', ratingsPath]);

    expect(summary.humanEvaluation).toMatchObject({
      status: 'insufficient',
      ratingCount: 2,
      raterCount: 2,
      ratedSampleCount: 1,
      humanMeanScore: 4.5,
    });
    expect(summary.humanEvaluation.ratingsPath).toBe(ratingsPath);
    expect(report).toContain('Human-auto Pearson');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

  it('imports AI reviewer manual ratings without counting them as human ratings', () => {
    const ratingsRoot = mkdtempSync(join(tmpdir(), 'context-compression-agent-ratings-'));
    const ratingsPath = join(ratingsRoot, 'agent-ratings.jsonl');
    writeFileSync(ratingsPath, [
      JSON.stringify({
        sampleId: 'R1',
        raterId: 'codex-ai-reviewer',
        raterType: 'ai_agent_manual_review',
        score: 4,
        missingInfoNotes: 'Minor command specificity issue.',
        actionabilityNotes: 'Next action remains usable.',
      }),
    ].join('\n') + '\n', 'utf8');

    const { summary, report } = runRealContextEval('agent-manual-ratings', [
      { type: 'session', id: 'session-1' },
      { type: 'message', id: 'u', message: { role: 'user', content: 'Objective: import AI reviewer ratings separately from human ratings.' } },
      { type: 'message', id: 'a1', message: { role: 'assistant', content: 'Decision: keep AI reviewer ratings in agentManualEvaluation.' } },
      { type: 'message', id: 'n', message: { role: 'assistant', content: 'Next action: verify humanEvaluation remains missing_ratings.' } },
      ...Array.from({ length: 55 }, (_, index) => ({
        type: 'message',
        id: `noise-${index}`,
        message: { role: 'assistant', content: `Noise ${index}: agent manual evaluation ballast.` },
      })),
    ], ['--agent-manual-eval-ratings', ratingsPath]);

    expect(summary.humanEvaluation.status).toBe('missing_ratings');
    expect(summary.agentManualEvaluation).toMatchObject({
      status: 'insufficient_ai_review',
      ratingCount: 1,
      reviewerCount: 1,
      ratedSampleCount: 1,
      reviewerMeanScore: 4,
    });
    expect(summary.agentManualEvaluation.disclosure).toContain('Do not count as real human');
    expect(report).toContain('Agent Manual Evaluation');
    expect(report).toContain('Reviewer-auto Pearson');
  }, REAL_CONTEXT_EVAL_TIMEOUT_MS);

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
