import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRoleRegistry,
  listRoleContracts,
  resolveRoleContract,
} from '../../openclaw_runtime/src/agents/role-registry';
import {
  buildRoleSpawnContext,
  buildRoleSpawnParams,
  buildRoleSystemPrompt,
  spawnRoleSubagent,
} from '../../openclaw_runtime/src/agents/role-spawn';
import { runOrchestration } from '../../openclaw_runtime/src/agents/orchestrator-run';
import { roleEffortToThinking } from '../../openclaw_runtime/src/agents/role-effort';
import { getBuiltInRoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import { buildRolePermissionDenyList } from '../../openclaw_runtime/src/agents/role-permissions-policy';
import {
  clearMemoryCards,
  explainMemoryInjection,
  setMemoryStorePath,
  storeMemoryCard,
} from '../../openclaw_runtime/src/memory/memory-store';
import type { MemoryCard } from '../../openclaw_runtime/src/memory/types';

/** Inline subset of SpawnSubagentParams — avoids chaining through subagent-spawn.ts deps. */
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
  status: "accepted" | "forbidden" | "error";
  runId?: string;
  childSessionKey?: string;
  error?: string;
};

/** Inline subset of SpawnSubagentContext used by role-spawn mapping. */
interface FakeSpawnContext {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  requesterAgentIdOverride?: string;
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
}

let tempDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clawx-role-spawn-'));
  setMemoryStorePath(join(tempDir, 'role-memory.sqlite'));
});

afterEach(() => {
  delete process.env.OPENCLAW_ROLE_MEMORY_ENABLED;
  clearMemoryCards();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('role registry', () => {
  it('exposes built-in roles when no config roles are present', () => {
    const names = listRoleContracts().map((role) => role.name);
    expect(names).toContain('planner');
    expect(names).toContain('skeptic');
    expect(resolveRoleContract('implementer')?.tools).toContain('edit');
  });

  it('merges config roles and lets config override a built-in by name', () => {
    const registry = buildRoleRegistry({
      agents: {
        roles: [
          {
            name: 'data-scientist',
            display_name: 'Data Scientist',
            role_prompt: 'Analyze data, build models, and report findings with evidence.',
            tools: ['read', 'bash'],
            effort: 'high',
          },
          {
            // Overrides the built-in reviewer's tool set.
            name: 'reviewer',
            display_name: 'Reviewer',
            role_prompt: 'Review changes with an extra focus on performance regressions.',
            tools: ['read', 'grep'],
          },
        ],
      },
    });
    expect(registry.configRoleNames).toEqual(['data-scientist', 'reviewer']);
    expect(registry.byName.get('data-scientist')?.displayName).toBe('Data Scientist');
    expect(registry.byName.get('reviewer')?.tools).toEqual(['read', 'grep']);
    // Built-ins still present.
    expect(registry.byName.get('planner')).toBeTruthy();
  });

  it('skips invalid config roles and records issues without throwing', () => {
    const registry = buildRoleRegistry({
      agents: {
        roles: [{ name: 'Bad Name', role_prompt: 'x' }],
      },
    });
    expect(registry.configRoleNames).toEqual([]);
    expect(registry.issues.length).toBeGreaterThan(0);
    expect(registry.issues[0]).toMatchObject({ index: 0 });
  });
});

describe('role effort mapping', () => {
  it('maps role effort to a thinking level, with auto -> adaptive', () => {
    expect(roleEffortToThinking('auto')).toBe('adaptive');
    expect(roleEffortToThinking('xhigh')).toBe('xhigh');
    expect(roleEffortToThinking(undefined)).toBeUndefined();
  });
});

describe('role permissions policy', () => {
  it('denies write/edit/exec/bash when filesystem is read', () => {
    const deny = buildRolePermissionDenyList({
      ...getBuiltInRoleContract('architect')!,
      permissions: { filesystem: 'read', network: 'none', commands: [] },
    });
    expect(deny).toContain('write');
    expect(deny).toContain('edit');
    expect(deny).toContain('apply_patch');
    expect(deny).toContain('exec');
    expect(deny).toContain('bash');
    expect(deny).not.toContain('read');
  });

  it('denies all fs tools + shell when filesystem is none', () => {
    const deny = buildRolePermissionDenyList({
      ...getBuiltInRoleContract('planner')!,
      permissions: { filesystem: 'none', network: 'none', commands: [] },
    });
    expect(deny).toContain('read');
    expect(deny).toContain('write');
    expect(deny).toContain('glob');
    expect(deny).toContain('grep');
    expect(deny).toContain('exec');
    expect(deny).toContain('bash');
  });

  it('denies network tools when network is none', () => {
    const deny = buildRolePermissionDenyList({
      ...getBuiltInRoleContract('implementer')!,
      permissions: { filesystem: 'write', network: 'none', commands: [] },
    });
    expect(deny).toContain('web_search');
    expect(deny).toContain('web_fetch');
  });
});

describe('role-driven spawn mapping', () => {
  const architect = getBuiltInRoleContract('architect')!;

  it('compiles SOUL into the role system prompt', () => {
    const prompt = buildRoleSystemPrompt(architect, 'Extra orchestration framing.');
    expect(prompt).toContain('Role contract: architect');
    expect(prompt).toContain('Extra orchestration framing.');
  });

  it('maps model/effort/SOUL into spawn params', () => {
    const params = buildRoleSpawnParams(architect, { role: architect, task: 'design module' });
    expect(params.task).toBe('design module');
    expect(params.thinking).toBe('high');
    expect(params.roleSystemPrompt).toContain('Role contract: architect');
  });

  it('injects role memory through a context pack and records an explain entry', () => {
    const now = new Date('2026-06-12T00:00:00.000Z').toISOString();
    const card: MemoryCard = {
      id: 'mem_arch_1',
      type: 'role_experience',
      scope: 'role',
      scopeKey: null,
      roleTags: ['architect'],
      phaseTags: ['plan'],
      content: 'Architects must preserve renderer/main API boundaries.',
      evidence: ['AGENTS.md'],
      evidenceRefs: [{ type: 'file', ref: 'AGENTS.md' }],
      confidence: 0.95,
      importance: 0.8,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      version: 1,
      status: 'active',
      sensitivity: 'normal',
      durability: 'long_term',
      source: 'user',
      supersedes: null,
      supersededBy: null,
      expiresAt: null,
    };
    storeMemoryCard(card);
    const params = buildRoleSpawnParams(architect, { role: architect, task: 'design module' }, { agentSessionKey: 'agent:main:abc' });
    expect(params.roleSystemPrompt).toContain('## Memory Context');
    expect(params.roleSystemPrompt).toContain('Architects must preserve renderer/main API boundaries.');
    const injections = explainMemoryInjection({ roleName: 'architect' });
    expect(injections).toHaveLength(1);
    expect(injections[0]?.cardIds).toContain('mem_arch_1');
  });

  it('does not inject or record role memory when Role Memory is disabled', () => {
    process.env.OPENCLAW_ROLE_MEMORY_ENABLED = '0';
    const now = new Date('2026-06-12T00:00:00.000Z').toISOString();
    storeMemoryCard({
      id: 'mem_arch_disabled',
      type: 'constraint',
      scope: 'role',
      scopeKey: null,
      roleTags: ['architect'],
      phaseTags: ['plan'],
      content: 'Architects must preserve renderer/main API boundaries.',
      evidence: ['AGENTS.md'],
      evidenceRefs: [{ type: 'file', ref: 'AGENTS.md' }],
      confidence: 0.95,
      importance: 0.8,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      version: 1,
      status: 'active',
      sensitivity: 'normal',
      durability: 'long_term',
      source: 'user',
      supersedes: null,
      supersededBy: null,
      expiresAt: null,
    });

    const params = buildRoleSpawnParams(architect, { role: architect, task: 'design module' }, { agentSessionKey: 'agent:main:abc' });

    expect(params.roleSystemPrompt).not.toContain('## Memory Context');
    expect(params.roleSystemPrompt).not.toContain('Architects must preserve renderer/main API boundaries.');
    expect(explainMemoryInjection({ roleName: 'architect' })).toHaveLength(0);
  });

  it('sets a hard tool allowlist from the role tools + permission-derived deny', () => {
    const ctx: FakeSpawnContext = { agentSessionKey: 'agent:main:abc' };
    const roleCtx = buildRoleSpawnContext(architect, ctx);
    expect(roleCtx.inheritedToolAllowlist).toEqual(architect.tools);
    // architect has filesystem=read → deny write/edit/apply_patch/exec/bash
    expect(roleCtx.inheritedToolDenylist).toContain('write');
    expect(roleCtx.inheritedToolDenylist).toContain('exec');
  });

  it('spawns through an injected spawn fn and reports role-not-found', async () => {
    const calls: FakeSpawnParams[] = [];
    const fakeSpawn = async (params: FakeSpawnParams): Promise<FakeSpawnResult> => {
      calls.push(params);
      return { status: 'accepted', runId: 'run_1', childSessionKey: 'child_1' };
    };
    const ok = await spawnRoleSubagent(
      { role: 'tester', task: 'write tests' },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as any },
    );
    expect(ok.status).toBe('accepted');
    expect(ok.role?.name).toBe('tester');
    expect(calls[0]?.roleSystemPrompt).toContain('Role contract: tester');

    const missing = await spawnRoleSubagent(
      { role: 'does-not-exist', task: 'x' },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as any },
    );
    expect(missing.status).toBe('role-not-found');
  });
});

describe('orchestrator run bridge', () => {
  it('spawns initial workers and defers verifier through orchestration metadata', async () => {
    const spawned: FakeSpawnParams[] = [];
    let counter = 0;
    const fakeSpawn = async (params: FakeSpawnParams): Promise<FakeSpawnResult> => {
      spawned.push(params);
      counter += 1;
      return { status: 'accepted', runId: `run_${counter}`, childSessionKey: `child_${counter}` };
    };
    const result = await runOrchestration(
      { task: '重构这个模块并补充测试', fileHints: ['a.ts', 'b.ts', 'c.ts'] },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as any },
    );
    expect(result.plan.mode).toBe('lead-workers');
    // v2 starts workers first; verifier is gated on worker completion.
    expect(result.spawnedRunIds.length).toBe(spawned.length);
    expect(result.outcomes.some((outcome) => outcome.isVerifier)).toBe(false);
    expect(result.pendingVerifier).toBe(true);
    expect(result.failures).toHaveLength(0);
    // each worker received its role SOUL + orchestration framing
    expect(spawned.every((params) => params.roleSystemPrompt?.includes('Orchestration Context'))).toBe(true);
  });

  it('records failures when a spawn is rejected', async () => {
    const fakeSpawn = async (): Promise<FakeSpawnResult> => ({
      status: 'forbidden',
      error: 'max children reached',
    });
    const result = await runOrchestration(
      { task: '解释这个函数做什么' },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as any },
    );
    expect(result.plan.mode).toBe('router');
    expect(result.spawnedRunIds).toHaveLength(0);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('honors template roles and maxWorkers before spawning', async () => {
    const spawned: FakeSpawnParams[] = [];
    const fakeSpawn = async (params: FakeSpawnParams): Promise<FakeSpawnResult> => {
      spawned.push(params);
      return { status: 'accepted', runId: `run_${spawned.length}`, childSessionKey: `child_${spawned.length}` };
    };
    const result = await runOrchestration(
      { task: 'security audit', templateId: 'security-audit', maxWorkers: 1, orchestrationRunId: 'orch_test' },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as any },
    );
    expect(result.plan.templateId).toBe('security-audit');
    expect(result.plan.workers.map((worker) => worker.roleName)).toEqual(['security-reviewer', 'reviewer', 'tester']);
    expect(result.executionWaves.every((wave) => wave.roles.length <= 1)).toBe(true);
    expect(result.outcomes.map((outcome) => outcome.roleName)).toEqual(['security-reviewer', 'reviewer', 'tester']);
    expect(result.pendingVerifier).toBe(true);
    expect(spawned.every((params) => params.roleSystemPrompt?.includes('Original task: security audit'))).toBe(true);
    expect(spawned[0]?.roleSystemPrompt).toContain('Blocking marker: non-blocking worker');
    expect(spawned[0]?.orchestration).toMatchObject({
      orchestrationRunId: 'orch_test',
      roleName: 'security-reviewer',
      phase: 'worker',
      isVerifier: false,
    });
  });
});
