import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The handler module imports the native spawnSubagentDirect, which pulls in the
// full @openclaw/* runtime dependency tree (not aliased under vitest). Mock it
// at module scope so the handler file loads in the test environment. The
// orchestrator.run handler passes this through to runOrchestrationObserved,
// and real execution is covered via the injected-fake-spawn test below.
vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({
  spawnSubagentDirect: vi.fn(),
}));

vi.mock('../../openclaw_runtime/src/media/image-ops.js', () => ({
  IMAGE_REDUCE_QUALITY_STEPS: [85, 75, 65, 55, 45, 35],
  ImageProcessorUnavailableError: class ImageProcessorUnavailableError extends Error {},
  buildImageResizeSideGrid: vi.fn(() => []),
  convertHeicToJpeg: vi.fn(async (buffer: Buffer) => buffer),
  createImageProcessor: vi.fn(),
  getImageMetadata: vi.fn(async () => null),
  hasAlphaChannel: vi.fn(async () => false),
  isImageProcessorUnavailableError: vi.fn(() => false),
  normalizeExifOrientation: vi.fn(async (buffer: Buffer) => buffer),
  optimizeImageToPng: vi.fn(),
  readImageMetadataFromHeader: vi.fn(() => null),
  readImageProbeFromHeader: vi.fn(() => null),
  resizeToJpeg: vi.fn(async ({ buffer }: { buffer: Buffer }) => buffer),
  resizeToPng: vi.fn(async ({ buffer }: { buffer: Buffer }) => buffer),
}));

vi.mock('rastermill', () => ({
  createRastermill: () => ({
    probe: vi.fn(),
    encode: vi.fn(),
  }),
  isRastermillUnavailableError: () => false,
  RastermillError: class RastermillError extends Error {},
  RastermillUnavailableError: class RastermillUnavailableError extends Error {},
  readImageProbeFromHeader: vi.fn(),
  readImageMetadataFromHeader: vi.fn(),
}), { virtual: true });

// Gateway handlers â€?the integration surface under test.
import { roleOrchestrationHandlers } from '../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods';
import { spawnSubagentDirect } from '../../openclaw_runtime/src/agents/subagent-spawn';
// Role-first execution + observability.
import { runOrchestrationObserved } from '../../openclaw_runtime/src/agents/orchestrator-run-observed';
import { createTeamOrchestrateTool } from '../../openclaw_runtime/src/agents/tools/team-orchestrate-tool';
import { isToolAllowedByPolicyName } from '../../openclaw_runtime/src/agents/tool-policy-match';
import { getBuiltInRoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import { buildRoleSpawnContext } from '../../openclaw_runtime/src/agents/role-spawn';
import { getRuntimeTraceBuffer, clearRuntimeTraceBuffer } from '../../openclaw_runtime/src/observability/trace-buffer';
import { clearMemoryCards, setMemoryStorePath } from '../../openclaw_runtime/src/memory/memory-store';
import {
  buildHandlerArgs,
  configWithRoles,
  emptyConfig,
  type CapturedRespond,
} from './helpers/role-gateway-test-utils';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

/** Fake spawn shape mirroring role-spawn.test.ts inline types. */
type FakeSpawnParams = {
  task: string;
  label?: string;
  agentId?: string;
  model?: string;
  thinking?: string;
  mode?: string;
  cwd?: string;
  runTimeoutSeconds?: number;
  roleSystemPrompt?: string;
  orchestration?: {
    orchestrationRunId: string;
    roleName: string;
    isVerifier: boolean;
    phase: string;
  };
};
type FakeSpawnResult = {
  status: 'accepted' | 'forbidden' | 'error';
  runId?: string;
  childSessionKey?: string;
  note?: string;
  error?: string;
};

/** Invoke a named handler with captured args; returns the single respond() call. */
async function callHandler(
  method: string,
  params: Record<string, unknown>,
  cfg = emptyConfig(),
): Promise<CapturedRespond | undefined> {
  const captured: CapturedRespond[] = [];
  const handler = (roleOrchestrationHandlers as Record<string, (args: unknown) => Promise<void>>)[method];
  if (!handler) throw new Error(`unknown handler: ${method}`);
  await handler(buildHandlerArgs(params, cfg, captured));
  return captured[0];
}

afterEach(() => {
  delete process.env.OPENCLAW_ROLE_MEMORY_ENABLED;
  delete process.env.OPENCLAW_MEMORY_USE_GATE;
  clearRuntimeTraceBuffer();
  clearMemoryCards();
});

describe('roles.* / teams.* handlers', () => {
  it('roles.list returns builtin roles and count', async () => {
    const res = await callHandler('roles.list', {});
    expect(res?.ok).toBe(true);
    const payload = res?.payload as { roles: { name: string }[]; count: number };
    expect(payload.count).toBe(payload.roles.length);
    expect(payload.roles.map((r) => r.name)).toContain('architect');
    expect(payload.roles.map((r) => r.name)).toContain('skeptic');
  });

  it('roles.list merges config-defined roles', async () => {
    const cfg = configWithRoles([
      { name: 'data-scientist', display_name: 'Data Scientist', role_prompt: 'Analyze data.', tools: ['read', 'bash'], effort: 'high' },
    ]);
    const res = await callHandler('roles.list', {}, cfg);
    expect(res?.ok).toBe(true);
    const names = (res?.payload as { roles: { name: string }[] }).roles.map((r) => r.name);
    expect(names).toContain('data-scientist');
    expect(names).toContain('architect'); // builtins still present
  });

  it('roles.get returns a role contract + compiled SOUL', async () => {
    const res = await callHandler('roles.get', { name: 'architect' });
    expect(res?.ok).toBe(true);
    const payload = res?.payload as { role: { name: string }; soul: string };
    expect(payload.role.name).toBe('architect');
    expect(payload.soul).toContain('Role contract: architect');
  });

  it('roles.get errors on unknown role', async () => {
    const res = await callHandler('roles.get', { name: 'no-such-role' });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/unknown role/);
  });

  it('teams.list returns a snapshot', async () => {
    const res = await callHandler('teams.list', {});
    expect(res?.ok).toBe(true);
    const payload = res?.payload as { templates: unknown[]; defaultTemplateId: string };
    expect(payload.templates).toBeDefined();
    expect(payload.defaultTemplateId).toBeDefined();
  });

  // ── Area 1: Role origin surfacing ──────────────────────────────────────

  it('roles.list surfaces origin=built-in for untouched built-ins', async () => {
    const res = await callHandler('roles.list', {});
    expect(res?.ok).toBe(true);
    const roles = (res?.payload as { roles: { name: string; origin?: string }[] }).roles;
    const reviewer = roles.find((r) => r.name === 'reviewer');
    expect(reviewer?.origin).toBe('built-in');
    const architect = roles.find((r) => r.name === 'architect');
    expect(architect?.origin).toBe('built-in');
  });

  it('roles.list surfaces origin=config for a fresh config-defined role', async () => {
    const cfg = configWithRoles([
      { name: 'data-scientist', display_name: 'Data Scientist', role_prompt: 'Analyze data.', tools: ['read', 'bash'], effort: 'high' },
    ]);
    const res = await callHandler('roles.list', {}, cfg);
    expect(res?.ok).toBe(true);
    const roles = (res?.payload as { roles: { name: string; origin?: string }[] }).roles;
    const ds = roles.find((r) => r.name === 'data-scientist');
    expect(ds?.origin).toBe('config');
    // built-ins that were not overridden stay built-in
    const architect = roles.find((r) => r.name === 'architect');
    expect(architect?.origin).toBe('built-in');
  });

  it('roles.list surfaces origin=config when a built-in is overridden by config', async () => {
    const cfg = configWithRoles([
      { name: 'reviewer', display_name: 'Custom Reviewer', role_prompt: 'Review with custom rules.', tools: ['read'], effort: 'xhigh' },
    ]);
    const res = await callHandler('roles.list', {}, cfg);
    expect(res?.ok).toBe(true);
    const roles = (res?.payload as { roles: { name: string; origin?: string }[] }).roles;
    const reviewer = roles.find((r) => r.name === 'reviewer');
    expect(reviewer?.origin).toBe('config');
    expect(reviewer?.displayName).toBe('Custom Reviewer');
  });

  it('roles.get surfaces origin field', async () => {
    const res = await callHandler('roles.get', { name: 'reviewer' });
    expect(res?.ok).toBe(true);
    const role = (res?.payload as { role: { name: string; origin?: string } }).role;
    expect(role.origin).toBe('built-in');
  });
});

describe('orchestrator.plan handler', () => {
  it('errors when task is empty', async () => {
    const res = await callHandler('orchestrator.plan', { task: '   ' });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/task/);
  });

  it('returns a plan with mode/leadRole/workers', async () => {
    const res = await callHandler('orchestrator.plan', { task: 'implement the login feature and fix bugs' });
    expect(res?.ok).toBe(true);
    const plan = (res?.payload as { plan: { mode: string; leadRole: string; workers: unknown[] } }).plan;
    expect(typeof plan.mode).toBe('string');
    expect(typeof plan.leadRole).toBe('string');
    expect(Array.isArray(plan.workers)).toBe(true);
  });

  it('honors preferredLeadRole when it is a known role', async () => {
    const res = await callHandler('orchestrator.plan', { task: 'explain this', leadRole: 'reviewer' });
    expect(res?.ok).toBe(true);
    const plan = (res?.payload as { plan: { leadRole: string } }).plan;
    expect(plan.leadRole).toBe('reviewer');
  });

  it('ignores preferredLeadRole that is not a known role', async () => {
    const res = await callHandler('orchestrator.plan', { task: 'explain this', leadRole: 'ghost-role' });
    expect(res?.ok).toBe(true);
    const plan = (res?.payload as { plan: { leadRole: string; reasons: string[] } }).plan;
    // router mode â†?leadRole is the routed primary, not the ghost role.
    expect(plan.leadRole).not.toBe('ghost-role');
    expect(plan.reasons.some((r) => String(r).includes('preferred-lead'))).toBe(false);
  });

  it('errors on unknown team template id', async () => {
    const res = await callHandler('orchestrator.plan', { task: 'do work', templateId: 'ghost-team' });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/unknown team template/);
  });

  it('plans with a known team template id', async () => {
    const res = await callHandler('orchestrator.plan', {
      task: 'security review',
      templateId: 'security-audit',
      maxWorkers: 2,
    });
    expect(res?.ok).toBe(true);
    const payload = res?.payload as {
      plan: { templateId?: string; verifierRole?: string; workers: Array<{ roleName: string }> };
      executionWaves: Array<{ roles: string[] }>;
    };
    const plan = payload.plan;
    expect(plan.templateId).toBe('security-audit');
    expect(plan.verifierRole).toBe('skeptic');
    expect(plan.workers.map((worker) => worker.roleName)).toEqual(['security-reviewer', 'reviewer', 'tester']);
    expect(payload.executionWaves.every((wave) => wave.roles.length <= 2)).toBe(true);
  });

  it('returns structured P2 complexity and runbook metadata without dropping scheduler fields', async () => {
    const res = await callHandler('orchestrator.plan', {
      task: 'fix failing test suite after repeated failures',
      priorFailureCount: 2,
      runbookId: 'test-repair',
      maxWorkers: 2,
    });

    expect(res?.ok).toBe(true);
    const payload = res?.payload as {
      plan: {
        complexityDecision?: { mode: string; selectedRunbookId?: string; reasons: string[] };
        runbookSelection?: {
          selected?: { runbookId: string; reasons: string[] };
          unselected: Array<{ runbookId: string; reasons: string[] }>;
        };
        taskGraph: { graphRunId: string };
      };
      complexityDecision?: { mode: string; selectedRunbookId?: string };
      runbookSelection?: { selected?: { runbookId: string }; unselected: unknown[] };
      taskGraph: { graphRunId: string };
      executionWaves: unknown[];
    };
    expect(payload.complexityDecision).toMatchObject({
      mode: 'runbook-orchestrated',
      selectedRunbookId: 'test-repair',
    });
    expect(payload.runbookSelection?.selected).toMatchObject({
      runbookId: 'test-repair',
      reasons: expect.arrayContaining(['explicit-runbook-match']),
    });
    expect(payload.runbookSelection?.unselected.length).toBeGreaterThan(0);
    expect(payload.plan.complexityDecision).toEqual(payload.complexityDecision);
    expect(payload.plan.runbookSelection).toEqual(payload.runbookSelection);
    expect(payload.taskGraph.graphRunId).toBe('test-repair');
    expect(payload.executionWaves).toEqual(expect.any(Array));
  });

  it('accepts explicit duplicate workers and preserves labels', async () => {
    const res = await callHandler('orchestrator.plan', {
      task: 'compare implementation approaches',
      workers: [
        { roleName: 'architect', label: 'Conservative', task: 'Compare a conservative path' },
        { roleName: 'architect', label: 'Modular', task: 'Compare a modular path' },
        { roleName: 'architect', label: 'Integration-first', task: 'Compare an integration-first path' },
      ],
    });
    expect(res?.ok).toBe(true);
    const plan = (res?.payload as { plan: { mode: string; leadRole: string; workers: Array<{ roleName: string; label?: string; task: string }> } }).plan;
    expect(plan.mode).toBe('lead-workers');
    expect(plan.leadRole).toBe('architect');
    expect(plan.workers.map((worker) => worker.roleName)).toEqual(['architect', 'architect', 'architect']);
    expect(plan.workers.map((worker) => worker.label)).toEqual(['Conservative', 'Modular', 'Integration-first']);
    expect(plan.workers.map((worker) => worker.task)).toEqual([
      'Compare a conservative path',
      'Compare a modular path',
      'Compare an integration-first path',
    ]);
  });

  it('projects the anchor agent id and stable node ids across duplicate roles', async () => {
    const res = await callHandler('orchestrator.plan', {
      task: 'compare implementation approaches',
      agentId: 'research',
      workers: [
        { roleName: 'architect', task: 'Compare a conservative path' },
        { roleName: 'architect', task: 'Compare a modular path' },
      ],
    });
    expect(res?.ok).toBe(true);
    const payload = res?.payload as {
      taskGraph: { nodes: Array<{ taskNodeId: string; agentId?: string; roleName: string }> };
    };
    expect(payload.taskGraph.nodes.every((node) => node.agentId === 'research')).toBe(true);
    expect(new Set(payload.taskGraph.nodes.map((node) => node.taskNodeId)).size).toBe(payload.taskGraph.nodes.length);
  });

  it('errors when explicit workers are empty', async () => {
    const res = await callHandler('orchestrator.plan', {
      task: 'compare implementation approaches',
      workers: [],
    });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/workers.*non-empty array/);
  });

  it('errors when explicit workers include an unknown role', async () => {
    const res = await callHandler('orchestrator.plan', {
      task: 'compare implementation approaches',
      workers: [{ roleName: 'ghost-role', task: 'Do impossible work' }],
    });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/unknown role/);
  });
});

describe('orchestrator.run handler', () => {
  it('errors when task is empty', async () => {
    const res = await callHandler('orchestrator.run', { task: '', sessionKey: 'agent:main:s' });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/task/);
  });

  it('errors when sessionKey is missing', async () => {
    const res = await callHandler('orchestrator.run', { task: 'do work' });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/sessionKey/);
  });

  it('returns scheduler metrics in the gateway run payload', { timeout: 15_000 }, async () => {
    vi.mocked(spawnSubagentDirect).mockResolvedValue({
      status: 'accepted',
      runId: 'run_gateway_1',
      childSessionKey: 'child_gateway_1',
    });

    const res = await callHandler('orchestrator.run', {
      task: 'security review',
      sessionKey: 'agent:main:gateway',
      templateId: 'security-audit',
      maxWorkers: 2,
    });

    expect(res?.ok).toBe(true);
    expect(res?.payload).toMatchObject({
      schedulerMetrics: {
        concurrencyCap: 2,
        queued: expect.any(Number),
        completed: expect.any(Number),
        skipped: 0,
        roleCostSummary: expect.any(Array),
      },
      resultBundle: {
        schemaVersion: 1,
        phase: 'spawn',
      },
      qualityDecision: {
        result: {
          state: 'shadow',
          source: 'ordinary_orchestration_scorecard',
          verified: false,
          routingEligible: false,
        },
        routing: {
          affected: false,
          authority: { state: 'unavailable', source: 'none' },
        },
      },
    });
  });

  it('returns P2 metadata in gateway run payload alongside P0/P1 data', { timeout: 15_000 }, async () => {
    vi.mocked(spawnSubagentDirect).mockResolvedValue({
      status: 'accepted',
      runId: 'run_gateway_p2',
      childSessionKey: 'child_gateway_p2',
    });

    const res = await callHandler('orchestrator.run', {
      task: 'fix failing test suite after repeated failures',
      sessionKey: 'agent:main:gateway-p2',
      priorFailureCount: 2,
      runbookId: 'test-repair',
      maxWorkers: 2,
    });

    expect(res?.ok).toBe(true);
    expect(res?.payload).toMatchObject({
      complexityDecision: {
        mode: 'runbook-orchestrated',
        selectedRunbookId: 'test-repair',
      },
      runbookSelection: {
        selected: {
          runbookId: 'test-repair',
        },
        unselected: expect.any(Array),
      },
      schedulerMetrics: {
        concurrencyCap: 2,
      },
      resultBundle: {
        schemaVersion: 1,
        phase: 'spawn',
      },
    });
  });

  it('returns P4 synthesis in the gateway run payload without removing existing metadata', async () => {
    vi.mocked(spawnSubagentDirect).mockResolvedValue({
      status: 'accepted',
      runId: 'run_gateway_p4',
      childSessionKey: 'child_gateway_p4',
    });

    const res = await callHandler('orchestrator.run', {
      task: 'implement and verify a bounded orchestration result',
      sessionKey: 'agent:main:gateway-p4',
      maxWorkers: 2,
    });

    expect(res?.ok).toBe(true);
    expect(res?.payload).toMatchObject({
      resultBundle: {
        schemaVersion: 1,
        phase: 'spawn',
      },
      schedulerMetrics: {
        concurrencyCap: 2,
      },
      synthesis: {
        schemaVersion: 1,
        orchestrationRunId: expect.any(String),
        status: expect.any(String),
        policy: {
          toolAccess: 'none',
          verifierAuthority: 'preserved',
          memoryWrite: 'none',
        },
      },
    });
  });
});

describe('runOrchestrationObserved (observed execution + tracing)', () => {
  const baseCtx = { agentSessionKey: 'agent:main:abc' };

  it('spawns initial workers through the injected fn and records a trace', async () => {
    const spawned: FakeSpawnParams[] = [];
    let counter = 0;
    const fakeSpawn = async (params: FakeSpawnParams): Promise<FakeSpawnResult> => {
      spawned.push(params);
      counter += 1;
      return { status: 'accepted', runId: `run_${counter}`, childSessionKey: `child_${counter}` };
    };
    clearRuntimeTraceBuffer();
    const result = await runOrchestrationObserved(
      { task: 'Refactor this module and add focused tests', fileHints: ['a.ts', 'b.ts', 'c.ts'] },
      baseCtx,
      { spawn: fakeSpawn as unknown as never },
      { sessionKey: 'agent:main:abc' },
    );
    // All workers spawned, each carries orchestration framing + role SOUL.
    expect(spawned.length).toBe(result.outcomes.length);
    expect(spawned.every((p) => p.roleSystemPrompt?.includes('Orchestration Context'))).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.pendingVerifier).toBe(true);
    expect(spawned.some((p) => p.orchestration?.phase === 'verifier')).toBe(false);
    expect(result.resultBundle).toMatchObject({
      schemaVersion: 1,
      phase: 'spawn',
      orchestrationRunId: expect.any(String),
      leadRole: result.plan.leadRole,
    });
    expect(result.resultBundle.roleOutcomes.length).toBe(result.outcomes.length);
    expect(result.resultBundle.traceIds.length).toBeGreaterThanOrEqual(1);
    expect(result.blackboardState.entries.length).toBe(result.outcomes.length);
    expect(result.blackboardSummary).toMatchObject({
      entryCount: result.outcomes.length,
      unresolvedConflicts: 0,
      trustBoundaries: ['role-output'],
    });
    expect(result.schedulerMetrics).toMatchObject({
      concurrencyCap: expect.any(Number),
      queued: expect.any(Number),
      completed: expect.any(Number),
      skipped: 0,
    });
    expect(result.schedulerMetrics.roleCostSummary.length).toBeGreaterThan(0);
    // A trace was stored in the runtime buffer (the core observability fix).
    const traces = getRuntimeTraceBuffer();
    expect(traces.length).toBeGreaterThanOrEqual(1);
    const trace = traces[0];
    expect(trace.tags).toContain('role-first');
    // Span kinds reflect the orchestration structure.
    const kinds = trace.spans.map((s) => s.kind);
    expect(kinds).toContain('orchestrator');
    expect(kinds).toContain('subagent');
  });

  it('records a verifier span and marks failures on spawn rejection', async () => {
    const fakeSpawn = async (): Promise<FakeSpawnResult> => ({
      status: 'forbidden',
      error: 'max children reached',
    });
    clearRuntimeTraceBuffer();
    const result = await runOrchestrationObserved(
      { task: 'review security of the auth module', important: true },
      baseCtx,
      { spawn: fakeSpawn as unknown as never },
    );
    expect(result.spawnedRunIds).toHaveLength(0);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.resultBundle.failures.length).toBeGreaterThan(0);
    expect(result.resultBundle.permissionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'denied',
          reason: 'max children reached',
        }),
      ]),
    );
    expect(result.blackboardSummary).toMatchObject({
      entryCount: result.outcomes.length + result.failures.length,
      openRisks: result.failures.length,
      trustBoundaries: ['role-output'],
    });
    // Trace still persisted even on all-failures.
    expect(getRuntimeTraceBuffer().length).toBeGreaterThanOrEqual(1);
  });

  it('uses resolved role contracts for scheduler contention when request roles are omitted', async () => {
    const fakeSpawn = async (): Promise<FakeSpawnResult> => ({
      status: 'accepted',
      runId: 'run_conflict',
      childSessionKey: 'child_conflict',
    });

    const result = await runOrchestrationObserved(
      {
        task: 'write release notes and implementation code',
        workers: [
          { roleName: 'implementer', task: 'Implement the change' },
          { roleName: 'docs-writer', task: 'Document the change' },
        ],
        maxWorkers: 2,
      },
      baseCtx,
      { spawn: fakeSpawn as unknown as never },
    );

    expect(result.schedulerMetrics.concurrencyCap).toBe(2);
    expect(result.executionWaves.map((wave) => wave.roles)).toEqual([
      ['implementer'],
      ['docs-writer'],
    ]);
  });
});

describe('team_orchestrate tool', () => {
  it('runs router-mode orchestration without a template and returns yield guidance', async () => {
    const fakeSpawn = async (): Promise<FakeSpawnResult> => ({
      status: 'accepted',
      runId: 'run_team_1',
      childSessionKey: 'child_team_1',
      note: [
        '## Summary',
        'Reviewed src/example.ts and verified the behavior with tests.',
        'Evidence: tests/unit/example.test.ts passed and logs showed no failures.',
      ].join('\n'),
    });
    const tool = createTeamOrchestrateTool({
      agentSessionKey: 'agent:main:abc',
      config: emptyConfig(),
      deps: {
        spawn: fakeSpawn as unknown as never,
        idFactory: () => 'orch_test',
      },
    });
    const result = await tool.execute('call_1', { task: 'explain this function' });
    expect(result.details).toMatchObject({
      status: 'accepted',
      runId: 'orch_test',
      nextAction: 'yield_for_results',
    });
    const details = result.details as {
      plan: { mode: string };
      children: unknown[];
      pendingVerifier: boolean;
      resultPolicy: { completion: string };
      quality: Array<{ roleName: string; overall: string }>;
      qualityState: null | 'shadow' | 'active';
      qualityStateReason: string;
      qualityScorecard?: {
        overall: string;
        worst: string;
        reason: string;
        scorecardBacked: boolean;
        evidenceRefs: string[];
      };
      qualityDecision?: {
        result: { state: string; source: string; verified: boolean; routingEligible: boolean };
        routing: { affected: boolean; reason: string; authority: { state: string; source: string } };
      };
      resultPolicy: { completion: string; boundedA2aEnabled: boolean };
      resultBundle?: unknown;
      blackboardSummary?: { entryCount: number };
    };
    expect(details.plan.mode).toBe('router');
    expect(details.children).toHaveLength(1);
    expect(details.pendingVerifier).toBe(false);
    expect(details.resultPolicy.completion).toBe('team_result_bundle');
    expect(details.qualityState).toBe('shadow');
    expect(details.quality).toEqual(expect.arrayContaining([
      expect.objectContaining({
        roleName: expect.any(String),
        overall: expect.stringMatching(/good|needs_attention|poor_attempt/),
      }),
    ]));
    expect(details.qualityScorecard).toMatchObject({
      overall: expect.stringMatching(/good|needs_attention|poor_attempt/),
      worst: expect.stringMatching(/good|needs_attention|poor_attempt/),
      reason: expect.any(String),
      scorecardBacked: true,
      evidenceRefs: expect.arrayContaining([expect.stringMatching(/trace:|run:|orchestration:/)]),
    });
    expect(details.qualityStateReason).toMatch(/score/i);
    expect(details.qualityDecision).toMatchObject({
      result: {
        state: 'shadow',
        source: 'ordinary_orchestration_scorecard',
        verified: false,
        routingEligible: false,
      },
      routing: {
        affected: false,
        authority: { state: 'unavailable', source: 'none' },
      },
    });
    expect(details.resultPolicy.boundedA2aEnabled).toBe(false);
    expect(details.blackboardSummary?.entryCount).toBe(1);
    expect(details.resultBundle).toMatchObject({
      schemaVersion: 1,
      phase: 'spawn',
      orchestrationRunId: 'orch_test',
    });
  });

  it('uses template roles and reports partial failures', async () => {
    let calls = 0;
    const fakeSpawn = async (): Promise<FakeSpawnResult> => {
      calls += 1;
      return calls === 1
        ? { status: 'accepted', runId: 'run_ok', childSessionKey: 'child_ok' }
        : { status: 'forbidden', error: 'max children reached' };
    };
    const tool = createTeamOrchestrateTool({
      agentSessionKey: 'agent:main:abc',
      config: emptyConfig(),
      deps: {
        spawn: fakeSpawn as unknown as never,
        idFactory: () => 'orch_template',
      },
    });
    const result = await tool.execute('call_1', {
      task: 'security review',
      templateId: 'security-audit',
      maxWorkers: 2,
    });
    const details = result.details as {
      status: string;
      plan: { templateId?: string; verifierRole?: string; workers: Array<{ roleName: string }> };
      executionWaves: Array<{ roles: string[] }>;
      schedulerMetrics?: { concurrencyCap: number; roleCostSummary: unknown[] };
      failures: unknown[];
      orchestrationDiagnostics?: {
        kind: string;
        boundary: string;
        status: string;
        failedWorkerCount: number;
        taskLoopUpgradeAvailable: boolean;
        recommendations: Array<{ code: string; roleName?: string; recommendedAction: string }>;
        nextSteps: string[];
      };
      nextAction: string;
      pendingVerifier: boolean;
      expectedChildren: unknown[];
      quality: Array<{ roleName: string; overall: string }>;
      qualityState: null | 'shadow' | 'active';
      qualityScorecard?: {
        overall: string;
        worst: string;
        scorecardBacked: boolean;
      };
      qualityDecision?: {
        result: { state: string; source: string };
        routing: { affected: boolean };
      };
    };
    expect(details.status).toBe('partial');
    expect(details.plan.templateId).toBe('security-audit');
    expect(details.plan.verifierRole).toBe('skeptic');
    expect(details.plan.workers.map((worker) => worker.roleName)).toEqual(['security-reviewer', 'reviewer', 'tester']);
    expect(details.executionWaves.every((wave) => wave.roles.length <= 2)).toBe(true);
    expect(details.schedulerMetrics).toMatchObject({
      concurrencyCap: 2,
      roleCostSummary: expect.any(Array),
    });
    expect(details.failures).toHaveLength(2);
    expect(details.expectedChildren).toHaveLength(3);
    expect(details.pendingVerifier).toBe(true);
    expect(details.nextAction).toBe('yield_for_results');
    expect(details.qualityState).toBe('shadow');
    expect(details.quality).toEqual(expect.arrayContaining([
      expect.objectContaining({
        roleName: expect.any(String),
        overall: expect.stringMatching(/good|needs_attention|poor_attempt/),
      }),
    ]));
    expect(details.qualityScorecard).toMatchObject({
      overall: 'needs_attention',
      worst: 'poor_attempt',
      scorecardBacked: true,
    });
    expect(details.qualityDecision).toMatchObject({
      result: { state: 'shadow', source: 'ordinary_orchestration_scorecard' },
      routing: { affected: false },
    });
    expect(details).not.toHaveProperty('repairNodes');
    expect(details).not.toHaveProperty('blocked');
    expect(details).not.toHaveProperty('checkpoint');
    expect(details.orchestrationDiagnostics).toMatchObject({
      kind: 'ordinary-orchestration-diagnostics',
      boundary: 'diagnostics-only',
      status: 'needs_attention',
      failedWorkerCount: 2,
      taskLoopUpgradeAvailable: true,
    });
    expect(details.orchestrationDiagnostics?.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'worker-spawn-failed',
        roleName: 'reviewer',
      }),
      expect.objectContaining({
        code: 'worker-spawn-failed',
        roleName: 'tester',
      }),
    ]));
    expect(details.orchestrationDiagnostics?.nextSteps.join(' ')).toMatch(/Task Loop/i);
    expect(details.orchestrationDiagnostics?.recommendations.map((item) => item.recommendedAction).join(' ')).not.toMatch(/\b(repair|blocked|checkpoint)\b/i);
  });

  it('exposes P2 metadata from team_orchestrate details without granting permissions', async () => {
    const fakeSpawn = async (): Promise<FakeSpawnResult> => ({
      status: 'accepted',
      runId: 'run_p2_tool',
      childSessionKey: 'child_p2_tool',
    });
    const tool = createTeamOrchestrateTool({
      agentSessionKey: 'agent:main:abc',
      config: emptyConfig(),
      deps: {
        spawn: fakeSpawn as unknown as never,
        idFactory: () => 'orch_tool_p2',
      },
    });
    const result = await tool.execute('call_1', {
      task: 'fix failing test suite after repeated failures',
      priorFailureCount: 2,
      runbookId: 'test-repair',
      maxWorkers: 2,
    });
    const details = result.details as {
      complexityDecision?: { mode: string; selectedRunbookId?: string };
      runbookSelection?: { selected?: { runbookId: string }; unselected: unknown[] };
      schedulerMetrics?: { concurrencyCap: number };
      resultBundle?: { schemaVersion: number };
    };

    expect(details.complexityDecision).toMatchObject({
      mode: 'runbook-orchestrated',
      selectedRunbookId: 'test-repair',
    });
    expect(details.runbookSelection?.selected).toMatchObject({ runbookId: 'test-repair' });
    expect(details.schedulerMetrics?.concurrencyCap).toBe(2);
    expect(details.resultBundle?.schemaVersion).toBe(1);
  });

  it('exposes P4 synthesis from team_orchestrate details without granting tools', async () => {
    const fakeSpawn = async (): Promise<FakeSpawnResult> => ({
      status: 'accepted',
      runId: 'run_p4_tool',
      childSessionKey: 'child_p4_tool',
    });
    const tool = createTeamOrchestrateTool({
      agentSessionKey: 'agent:main:abc',
      config: emptyConfig(),
      deps: {
        spawn: fakeSpawn as unknown as never,
        idFactory: () => 'orch_tool_p4',
      },
    });
    const result = await tool.execute('call_1', {
      task: 'summarize verified orchestration evidence',
      maxWorkers: 2,
    });
    const details = result.details as {
      resultBundle?: { schemaVersion: number };
      schedulerMetrics?: { concurrencyCap: number };
      synthesis?: {
        orchestrationRunId: string;
        policy: { toolAccess: string; verifierAuthority: string; memoryWrite: string };
      };
    };

    expect(details.resultBundle?.schemaVersion).toBe(1);
    expect(details.schedulerMetrics?.concurrencyCap).toBe(2);
    expect(details.synthesis).toMatchObject({
      orchestrationRunId: 'orch_tool_p4',
      policy: {
        toolAccess: 'none',
        verifierAuthority: 'preserved',
        memoryWrite: 'none',
      },
    });
  });
});

describe('SECURITY: role.tools allowlist is enforced at the policy gate', () => {
  // This is the load-bearing security assertion: a non-empty allowlist is a
  // TRUE allowlist â€?tools not listed are denied by isToolAllowedByPolicyName.
  it('a role with tools=[read] cannot use write/edit/exec/bash', () => {
    const architect = getBuiltInRoleContract('architect')!;
    // architect.tools = [read, glob, grep] (read-only role)
    const ctx = buildRoleSpawnContext(architect, { agentSessionKey: 'agent:main:x' });
    const policy = {
      allow: ctx.inheritedToolAllowlist,
      deny: ctx.inheritedToolDenylist,
    };
    // allowed
    expect(isToolAllowedByPolicyName('read', policy)).toBe(true);
    expect(isToolAllowedByPolicyName('glob', policy)).toBe(true);
    expect(isToolAllowedByPolicyName('grep', policy)).toBe(true);
    // denied by allowlist (not in role.tools)
    expect(isToolAllowedByPolicyName('write', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('edit', policy)).toBe(false);
    // denied by both allowlist AND explicit deny (filesystem: read)
    expect(isToolAllowedByPolicyName('exec', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('bash', policy)).toBe(false);
  });

  it('a write-capable role (implementer) permits write/edit', () => {
    const implementer = getBuiltInRoleContract('implementer')!;
    const ctx = buildRoleSpawnContext(implementer, { agentSessionKey: 'agent:main:x' });
    const policy = { allow: ctx.inheritedToolAllowlist, deny: ctx.inheritedToolDenylist };
    expect(isToolAllowedByPolicyName('write', policy)).toBe(true);
    expect(isToolAllowedByPolicyName('edit', policy)).toBe(true);
    expect(isToolAllowedByPolicyName('read', policy)).toBe(true);
  });

  it('an empty allowlist means "allow everything not denied"', () => {
    // No allow list + a deny list = deny only the deny entries.
    expect(isToolAllowedByPolicyName('write', { allow: [], deny: ['exec'] })).toBe(true);
    expect(isToolAllowedByPolicyName('exec', { allow: [], deny: ['exec'] })).toBe(false);
  });

  it('network:"none" denies all network-capable tools including plugins', () => {
    // Build a custom role with network:"none" and expanded tools to test the deny list.
    const role = {
      ...getBuiltInRoleContract('architect')!,
      tools: ['read', 'glob', 'grep', 'web_search', 'web_fetch', 'x_search', 'code_execution', 'browser'],
      permissions: { filesystem: 'read' as const, network: 'none' as const, commands: [] },
    };
    const ctx = buildRoleSpawnContext(role, { agentSessionKey: 'agent:main:x' });
    const policy = { allow: ctx.inheritedToolAllowlist, deny: ctx.inheritedToolDenylist };
    // Core network tools denied
    expect(isToolAllowedByPolicyName('web_search', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('web_fetch', policy)).toBe(false);
    // Plugin network tools denied (the expanded NETWORK_TOOLS)
    expect(isToolAllowedByPolicyName('x_search', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('code_execution', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('browser', policy)).toBe(false);
  });

  it('network:"limited" denies high-risk tools but allows read-only retrieval', () => {
    // Override tools to include network tools so the allowlist doesn't reject them
    // (we're testing the deny-list behavior of the limited mapping, not the allowlist).
    const role = {
      ...getBuiltInRoleContract('architect')!,
      tools: ['read', 'glob', 'grep', 'web_search', 'web_fetch', 'code_execution', 'browser', 'x_search'],
      permissions: { filesystem: 'read' as const, network: 'limited' as const, commands: [] },
    };
    const ctx = buildRoleSpawnContext(role, { agentSessionKey: 'agent:main:x' });
    const policy = { allow: ctx.inheritedToolAllowlist, deny: ctx.inheritedToolDenylist };
    // Read-only retrieval still allowed under limited
    expect(isToolAllowedByPolicyName('web_search', policy)).toBe(true);
    expect(isToolAllowedByPolicyName('web_fetch', policy)).toBe(true);
    // High-risk network tools denied under limited
    expect(isToolAllowedByPolicyName('code_execution', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('browser', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('x_search', policy)).toBe(false);
  });

  it('commands allowlist with read-only fs denies shell tools', () => {
    const role = {
      ...getBuiltInRoleContract('architect')!,
      permissions: { filesystem: 'read' as const, network: 'full' as const, commands: ['npm', 'git'] },
    };
    const ctx = buildRoleSpawnContext(role, { agentSessionKey: 'agent:main:x' });
    const policy = { allow: ctx.inheritedToolAllowlist, deny: ctx.inheritedToolDenylist };
    // A non-empty command allowlist with read-only fs â†?shell denied at tool level
    expect(isToolAllowedByPolicyName('exec', policy)).toBe(false);
    expect(isToolAllowedByPolicyName('bash', policy)).toBe(false);
  });
});

describe('observability.* handlers (trace store/read round-trip)', () => {
  it('observability.reportTrace stores a trace; observability.traces returns it', async () => {
    const trace = {
      id: 'trace_test_1',
      name: 'test-trace',
      status: 'completed' as const,
      startedAt: 1000,
      spans: [],
      events: [],
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
      metrics: {},
      tags: [],
    };
    const storeRes = await callHandler('observability.reportTrace', { trace });
    expect(storeRes?.ok).toBe(true);
    expect((storeRes?.payload as { traceId: string }).traceId).toBe('trace_test_1');

    const listRes = await callHandler('observability.traces', {});
    expect(listRes?.ok).toBe(true);
    const traces = (listRes?.payload as { traces: { id: string }[] }).traces;
    expect(traces.map((t) => t.id)).toContain('trace_test_1');
  });

  it('observability.reportTrace rejects a trace without an id', async () => {
    const res = await callHandler('observability.reportTrace', { trace: { name: 'no-id' } });
    expect(res?.ok).toBe(false);
    expect(res?.error?.message).toMatch(/id/);
  });
});

describe('memory.* handlers (store/read round-trip with persistence)', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-mem-'));
    setMemoryStorePath(join(tempDir, 'role-memory.sqlite'));
    clearMemoryCards();
  });
  afterEach(() => {
    delete process.env.OPENCLAW_ROLE_MEMORY_ENABLED;
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns disabled read state and blocks writes when Role Memory is off', async () => {
    process.env.OPENCLAW_ROLE_MEMORY_ENABLED = '0';

    const listRes = await callHandler('memory.list', { status: 'all' });
    expect(listRes?.ok).toBe(true);
    expect(listRes?.payload).toMatchObject({ disabled: true, cards: [], count: 0 });

    const proposeRes = await callHandler('memory.propose', {
      proposal: {
        content: 'This should not be written while role memory is disabled.',
        type: 'fact',
        scope: 'role',
        roleTags: ['architect'],
        confidence: 0.9,
      },
    });
    expect(proposeRes?.ok).toBe(false);
    expect(proposeRes?.error?.message).toMatch(/disabled in Settings/);
  });

  it('memory.previewProposal returns governance preview without writing records', async () => {
    const previewRes = await callHandler('memory.previewProposal', {
      proposal: {
        content: 'Architects should preview role memory impact before applying changes.',
        type: 'constraint',
        scope: 'role',
        confidence: 0.95,
        importance: 0.8,
        roleTags: ['architect'],
        source: 'user',
        evidenceRefs: [{ type: 'manual', ref: 'test' }],
      },
    });
    expect(previewRes?.ok).toBe(true);
    const preview = (previewRes?.payload as { preview: { wouldWrite: boolean; decision: { accepted: boolean }; evidence: { status: string } } }).preview;
    expect(preview.wouldWrite).toBe(false);
    expect(preview.decision.accepted).toBe(true);
    expect(preview.evidence.status).toBe('verified');

    const listRes = await callHandler('memory.list', { status: 'all' });
    expect((listRes?.payload as { cards: unknown[] }).cards).toHaveLength(0);
  });

  it('memory.store accepts a proposal and memory.list returns it', async () => {
    const storeRes = await callHandler('memory.store', {
      proposal: {
        content: 'The project uses pnpm and TypeScript.',
        type: 'fact',
        scope: 'project',
        confidence: 0.95,
        roleTags: ['architect'],
        source: 'user',
        evidenceRefs: [{ type: 'manual', ref: 'test' }],
      },
    });
    expect(storeRes?.ok).toBe(true);
    const payload = storeRes?.payload as { accepted: boolean; card?: { id: string; content: string } };
    expect(payload.accepted).toBe(true);
    expect(payload.card?.content).toContain('pnpm');

    const listRes = await callHandler('memory.list', { scope: 'project' });
    const cards = (listRes?.payload as { cards: { id: string; content: string }[] }).cards;
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.some((c) => c.content.includes('pnpm'))).toBe(true);
  });

  it('memory.feedback records real utility feedback and memory.utilityReport does not invent eval deltas', async () => {
    const storeRes = await callHandler('memory.store', {
      proposal: {
        content: 'Architects should evaluate role memory with real feedback.',
        type: 'procedure',
        scope: 'role',
        confidence: 0.9,
        importance: 0.7,
        roleTags: ['architect'],
        source: 'user',
        evidenceRefs: [{ type: 'manual', ref: 'test' }],
      },
    });
    expect(storeRes?.ok).toBe(true);
    const card = (storeRes?.payload as { card?: { id: string } }).card;
    expect(card?.id).toBeTruthy();

    const feedbackRes = await callHandler('memory.feedback', {
      roleName: 'architect',
      cardId: card!.id,
      outcome: 'helpful',
      taskSuccess: 'unknown',
    });
    expect(feedbackRes?.ok).toBe(true);

    const listRes = await callHandler('memory.feedbackList', { roleName: 'architect' });
    expect((listRes?.payload as { feedback: unknown[] }).feedback).toHaveLength(1);

    const reportRes = await callHandler('memory.utilityReport', { roleName: 'architect' });
    const report = (reportRes?.payload as { report: { sample: { feedback: number }; aggregate: { taskSuccessDelta: number | null }; missingEvidence: string[] } }).report;
    expect(report.sample.feedback).toBe(1);
    expect(report.aggregate.taskSuccessDelta).toBeNull();
    expect(report.missingEvidence.some((entry) => entry.includes('memory-on/off'))).toBe(true);

    process.env.OPENCLAW_MEMORY_USE_GATE = '1';
    const evalRes = await callHandler('memory.evalReport', { roleName: 'architect', task: 'evaluate role memory feedback' });
    const evalPayload = evalRes?.payload as {
      report: { aggregate: { taskSuccessDelta: number | null } };
      dryRun?: {
        roleName: string;
        pack?: { candidateExplanations?: Array<{ cardId: string; selected: boolean }> };
      };
    };
    expect(evalPayload.report.aggregate.taskSuccessDelta).toBeNull();
    expect(evalPayload.dryRun?.roleName).toBe('architect');
    expect(evalPayload.dryRun?.pack?.candidateExplanations).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: card!.id, selected: true }),
    ]));
  });

  it('memory.store rejects a low-confidence proposal', async () => {
    const res = await callHandler('memory.store', {
      proposal: { content: 'maybe something', type: 'fact', scope: 'project', confidence: 0.1 },
    });
    const payload = res?.payload as { accepted: boolean; reason?: string };
    expect(payload.accepted).toBe(false);
  });

  it('memory.propose rejects fake keys without echoing the full secret in Gateway feedback', async () => {
    const fakeKey = 'OPENAI_API_KEY=sk-test1234567890ABCDE';
    const res = await callHandler('memory.propose', {
      proposal: {
        content: `Do not store this fake key: ${fakeKey}`,
        type: 'fact',
        scope: 'project',
        confidence: 0.95,
        roleTags: ['security'],
        source: 'user',
        evidenceRefs: [{ type: 'manual', ref: 'p1-13' }],
      },
    });

    expect(res?.ok).toBe(true);
    const payload = res?.payload as { action: string; accepted: boolean; reason?: string };
    expect(payload.accepted).toBe(false);
    expect(payload.action).toBe('reject');
    expect(payload.reason).toMatch(/Secret-like memory content/i);
    expect(JSON.stringify(payload)).not.toContain(fakeKey);

    const proposalsRes = await callHandler('memory.proposals', { decision: 'reject' });
    const proposalsPayload = proposalsRes?.payload as { proposals: unknown[] };
    expect(proposalsPayload.proposals).toHaveLength(1);
    expect(JSON.stringify(proposalsPayload)).not.toContain(fakeKey);

    const listRes = await callHandler('memory.list', { status: 'all' });
    const cards = (listRes?.payload as { cards: unknown[] }).cards;
    expect(cards).toHaveLength(0);
  });

  it('memory.propose sends duplicate active cards to review without writing a new card', async () => {
    const first = await callHandler('memory.propose', {
      proposal: {
        content: 'Architects should preserve host-api boundaries.',
        type: 'role_experience',
        scope: 'role',
        confidence: 0.9,
        roleTags: ['architect'],
        evidenceRefs: [{ type: 'manual', ref: 'test' }],
      },
    });
    expect((first?.payload as { accepted: boolean }).accepted).toBe(true);

    const duplicate = await callHandler('memory.propose', {
      proposal: {
        content: 'Architects should preserve host-api boundaries.',
        type: 'role_experience',
        scope: 'role',
        confidence: 0.9,
        roleTags: ['architect'],
      },
    });
    const duplicatePayload = duplicate?.payload as { action: string; accepted: boolean; conflicts?: unknown[] };
    expect(duplicatePayload.accepted).toBe(false);
    expect(duplicatePayload.action).toBe('needs_review');
    expect(duplicatePayload.conflicts?.length).toBeGreaterThan(0);

    const listRes = await callHandler('memory.list', { roleName: 'architect' });
    const cards = (listRes?.payload as { cards: unknown[] }).cards;
    expect(cards).toHaveLength(1);
  });

  it('memory.update, memory.archive, memory.supersede, and conflicts round-trip through SQLite', async () => {
    const created = await callHandler('memory.propose', {
      proposal: {
        content: 'Reviewers should check permission boundaries.',
        type: 'role_experience',
        scope: 'role',
        confidence: 0.9,
        roleTags: ['reviewer'],
        evidenceRefs: [{ type: 'manual', ref: 'test' }],
      },
    });
    const id = (created?.payload as { card: { id: string } }).card.id;

    const updated = await callHandler('memory.update', {
      id,
      patch: { content: 'Reviewers should check permission and IPC boundaries.' },
    });
    expect((updated?.payload as { accepted: boolean; card: { version: number } }).accepted).toBe(true);
    expect((updated?.payload as { card: { version: number } }).card.version).toBe(2);

    const archived = await callHandler('memory.archive', { id });
    expect((archived?.payload as { card: { status: string } }).card.status).toBe('archived');

    const replacement = await callHandler('memory.supersede', {
      id,
      proposal: {
        content: 'Reviewers should check IPC, host-api, and permission boundaries.',
        type: 'role_experience',
        scope: 'role',
        confidence: 0.9,
        roleTags: ['reviewer'],
        evidenceRefs: [{ type: 'manual', ref: 'test' }],
      },
    });
    expect((replacement?.payload as { action: string; accepted: boolean }).action).toBe('supersede');

    const conflicts = await callHandler('memory.conflicts', { status: 'open' });
    expect(Array.isArray((conflicts?.payload as { conflicts: unknown[] }).conflicts)).toBe(true);
  });
});
