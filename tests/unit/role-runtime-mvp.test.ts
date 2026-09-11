import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_ROLE_CONTRACTS,
  compileRoleContractToSoul,
  parseRoleContractYaml,
  validateRoleContract,
} from '../../openclaw_runtime/src/agents/role-contract';
import { routeRole } from '../../openclaw_runtime/src/agents/role-router';
import { createOrchestratorPlan, shouldUpgradeToTeam } from '../../openclaw_runtime/src/agents/orchestrator';
import { classifyInputIntent, resolveInputMode } from '../../openclaw_runtime/src/agents/input-classifier';
import { getTeamTemplateSnapshot } from '../../openclaw_runtime/src/agents/team-template';
import { calculateMemoryScore } from '../../openclaw_runtime/src/memory/memory-card';
import { buildContextPack } from '../../openclaw_runtime/src/memory/context-pack';
import { reviewMemoryProposal } from '../../openclaw_runtime/src/memory/gatekeeper';
import type { MemoryCard } from '../../shared/types/memory';

describe('role-first runtime MVP contracts', () => {
  it('parses and validates a YAML role contract while keeping SOUL output compatible', () => {
    const result = parseRoleContractYaml(`
name: architect
display_name: Architect
role_prompt: Design architecture, interfaces, module boundaries, and migration risks.
tools: [read, glob, grep]
permissions:
  filesystem: read
  network: none
  commands: []
model:
  default: claude-opus-4-8
  fallback: [claude-sonnet-4-6]
effort: high
output_schema:
  format: markdown
  sections: [Overview, Interfaces, Risks]
handoff:
  to: [implementer, reviewer]
  from: [planner]
`);

    expect(result.ok).toBe(true);
    expect(result.role?.name).toBe('architect');
    expect(result.role?.outputSchema.sections).toContain('Interfaces');
    expect(compileRoleContractToSoul(result.role!)).toContain('Role contract: architect');
  });

  it('ships nine valid built-in roles', () => {
    expect(BUILT_IN_ROLE_CONTRACTS.map((role) => role.name)).toEqual([
      'planner',
      'architect',
      'implementer',
      'tester',
      'reviewer',
      'security-reviewer',
      'docs-writer',
      'knowledge-librarian',
      'skeptic',
    ]);
    for (const role of BUILT_IN_ROLE_CONTRACTS) {
      expect(validateRoleContract(role)).toMatchObject({ ok: true });
    }
  });
});

describe('role-first runtime MVP routing and orchestration', () => {
  it('routes security-sensitive tasks to adversarial review with a security primary role', () => {
    const route = routeRole({
      task: '修复 auth secret 权限校验，并确保安全验收',
      fileHints: ['electron/utils/openclaw-auth.ts'],
    });

    expect(route.mode).toBe('adversarial-review');
    expect(route.primary.role.name).toBe('security-reviewer');
    expect(route.supporting.map((match) => match.role.name)).toContain('skeptic');
  });

  it('keeps simple work in router mode and upgrades multi-file work to a team', () => {
    const simple = createOrchestratorPlan({ task: '解释这个函数做什么' });
    expect(simple.mode).toBe('router');
    expect(simple.workers).toHaveLength(1);
    expect(shouldUpgradeToTeam(simple)).toBe(false);

    const complex = createOrchestratorPlan({
      task: '重构这个模块并补充测试',
      fileHints: ['a.ts', 'b.ts', 'c.ts'],
    });
    expect(complex.mode).toBe('lead-workers');
    expect(complex.workers.length).toBeGreaterThanOrEqual(3);
    expect(complex.verifierRole).toBe('reviewer');
    expect(shouldUpgradeToTeam(complex)).toBe(true);
  });

  it('uses team templates as real orchestration input and caps execution waves', () => {
    const plan = createOrchestratorPlan({
      task: 'review auth permissions and test the risks',
      templateId: 'security-audit',
      maxWorkers: 2,
    });
    expect(plan.templateId).toBe('security-audit');
    expect(plan.mode).toBe('adversarial-review');
    expect(plan.leadRole).toBe('security-reviewer');
    expect(plan.verifierRole).toBe('skeptic');
    expect(plan.workers.map((worker) => worker.roleName)).toEqual(['security-reviewer', 'reviewer', 'tester']);
    expect(plan.executionWaves.every((wave) => wave.roles.length <= 2)).toBe(true);
  });

  it('classifies interrupt, guide, and queue input modes with rule-based intent', () => {
    expect(classifyInputIntent('停下，先做数据库迁移').intent).toBe('interrupt');
    expect(resolveInputMode('btw 顺便考虑 Windows 路径')).toBe('guide');
    expect(resolveInputMode('等当前任务做完之后再更新 README')).toBe('queue');
  });

  it('exposes three MVP team templates', () => {
    const snapshot = getTeamTemplateSnapshot();
    expect(snapshot.defaultTemplateId).toBe('quick-development');
    expect(snapshot.templates.map((template) => template.id)).toEqual([
      'quick-development',
      'security-audit',
      'refactor',
    ]);
    expect(snapshot.templates.find((template) => template.id === 'security-audit')?.verifierRole).toBe('skeptic');
  });
});

describe('role-first runtime MVP memory and context pack', () => {
  const baseCard: MemoryCard = {
    id: 'mem_1',
    type: 'project_fact',
    scope: 'project',
    roleTags: ['architect'],
    content: 'The project uses pnpm and TypeScript.',
    evidence: ['package.json'],
    confidence: 0.9,
    importance: 0.8,
    lastAccessedAt: '2026-06-12T00:00:00.000Z',
    createdAt: '2026-06-12T00:00:00.000Z',
    accessCount: 1,
    version: 1,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    expiresAt: null,
  };

  it('calculates heat score with penalties', () => {
    expect(calculateMemoryScore({
      semanticRelevance: 1,
      importance: 1,
      recency: 1,
      accessFrequency: 1,
      roleRelevance: 1,
      stalenessPenalty: 0.2,
    })).toBe(0.8);
  });

  it('requires gatekeeper acceptance before committing long-term memory', () => {
    const rejected = reviewMemoryProposal({
      type: 'project_fact',
      scope: 'project',
      content: 'maybe true',
      confidence: 0.2,
    });
    expect(rejected.accepted).toBe(false);

    // TF-0118: commitMemoryProposal was a zero-production-caller wrapper over
    // reviewMemoryProposal + append. Inlined here so the assertions below still
    // cover the real review + commit semantics without the redundant export.
    const decision = reviewMemoryProposal({
      type: 'project_fact',
      scope: 'project',
      content: 'Verse Claw stores role contracts as structured YAML.',
      evidence: ['reports/role-first-runtime-implementation-analysis.md'],
      confidence: 0.9,
      importance: 0.7,
      roleTags: ['architect'],
      source: 'user',
    }, [], { idFactory: () => 'mem_new', now: new Date('2026-06-12T00:00:00.000Z') });
    const cards = decision.card ? [decision.card] : [];

    expect(decision.accepted).toBe(true);
    expect(cards[0]).toMatchObject({ id: 'mem_new', status: 'active' });
    expect(reviewMemoryProposal(cards[0], cards).accepted).toBe(false);
  });

  it('builds context packs within hard token budgets and excludes inactive memory', () => {
    const longCards: MemoryCard[] = Array.from({ length: 20 }, (_, index) => ({
      ...baseCard,
      id: `mem_${index}`,
      content: `Important project fact ${index}: ${'x'.repeat(120)}`,
      importance: 1 - index * 0.01,
    }));
    const pack = buildContextPack({
      memories: [...longCards, { ...baseCard, id: 'cold', status: 'cold', content: 'do not include' }],
      roleName: 'architect',
      taskState: 'Current task state must fit the task-state bucket.',
      budget: { total: 120, coreFacts: 80, taskState: 40 } as never,
    });

    expect(pack.estimatedTokens.total).toBeLessThanOrEqual(120);
    expect(pack.candidateExplanations?.length).toBeGreaterThan(0);
    expect(JSON.stringify(pack.buckets)).not.toContain('do not include');
  });
});
