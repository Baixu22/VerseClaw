// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_SEMANTIC_CONCEPTS,
  PRODUCT_SEMANTIC_CONTRACT_VERSION,
  PRODUCT_SEMANTIC_RELATIONS,
  PRODUCT_SEMANTIC_RELATION_RULES,
  PRODUCT_SEMANTIC_TASK_BOUNDARIES,
  PRODUCT_SEMANTIC_UNSAFE_CLAIMS,
  createPermissionDecisionEvent,
  createTaskLedgerReference,
  createTaskLoopUpgradeSuggestion,
  normalizeOrchestrationQualityState,
  orchestrationQualityAffectsRouting,
  relationKey,
  validateProductSemanticRelation,
  validateProductSemanticRelations,
  type ProductSemanticRelationDiagnostic,
} from '@shared/product-semantics';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NEGATIVE_FIXTURE_DIR = path.join(ROOT, 'harness/specs/fixtures/ontology-lite-existing-contracts/negatives');

type RelationFixture = {
  schema: 'ProductSemanticRelationFixture/v1';
  id: string;
  umbrellaRow: number[];
  candidate: unknown;
  context?: Parameters<typeof validateProductSemanticRelation>[1];
  expect: { rule: ProductSemanticRelationDiagnostic['rule']; field: string };
};

function loadNegativeFixtures(): RelationFixture[] {
  return readdirSync(NEGATIVE_FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(NEGATIVE_FIXTURE_DIR, name), 'utf8')) as RelationFixture)
    .filter((fixture) => fixture.schema === 'ProductSemanticRelationFixture/v1');
}

function runFixture(fixture: RelationFixture): ProductSemanticRelationDiagnostic[] {
  return Array.isArray(fixture.candidate)
    ? validateProductSemanticRelations(fixture.candidate, fixture.context).diagnostics
    : validateProductSemanticRelation(fixture.candidate, fixture.context);
}

const NEGATIVE_FIXTURES = loadNegativeFixtures();

describe('ClawX product semantics', () => {
  it('pins the seven product concepts to distinct responsibilities', () => {
    expect(PRODUCT_SEMANTIC_CONCEPTS.map((concept) => concept.id)).toEqual([
      'chat',
      'plan-mode',
      'chat-plan',
      'task-ledger',
      'workboard',
      'task-loop',
      'routing-memo',
    ]);

    expect(PRODUCT_SEMANTIC_CONCEPTS.find((concept) => concept.id === 'task-ledger')).toMatchObject({
      sourceOfTruth: 'user-visible task facts',
      forbiddenClaims: expect.arrayContaining([
        expect.stringContaining('execution scheduler'),
      ]),
    });
    expect(PRODUCT_SEMANTIC_CONCEPTS.find((concept) => concept.id === 'workboard')).toMatchObject({
      sourceOfTruth: 'runtime/plugin scheduling',
      allowedReferences: expect.arrayContaining(['Task Ledger node id']),
      forbiddenClaims: expect.arrayContaining([
        expect.stringContaining('two-way sync'),
      ]),
    });
  });

  it('keeps product relationships typed, directed, evidence-backed, and authority-bounded', () => {
    const concepts = new Set(PRODUCT_SEMANTIC_CONCEPTS.map(({ id }) => id));
    const keys = PRODUCT_SEMANTIC_RELATIONS.map(({ from, kind, to }) => [from, kind, to].join(':'));
    expect(new Set(keys).size).toBe(keys.length);
    for (const relation of PRODUCT_SEMANTIC_RELATIONS) {
      expect(concepts.has(relation.from)).toBe(true);
      expect(concepts.has(relation.to)).toBe(true);
      expect(relation.from).not.toBe(relation.to);
      expect(relation.evidenceRefs.length).toBeGreaterThan(0);
    }
    expect(PRODUCT_SEMANTIC_RELATIONS.filter(({ from }) => String(from) === 'task-ledger')).toHaveLength(0);
    expect(PRODUCT_SEMANTIC_RELATIONS.find(({ kind, to }) => kind === 'references-one-way' && to === 'task-ledger')).toMatchObject({
      from: 'workboard',
      authorityBoundary: 'one-way-reference',
    });
  });

  it('uses explicit orchestration quality states instead of an empty array ambiguity', () => {
    expect(normalizeOrchestrationQualityState(undefined)).toBeNull();
    expect(normalizeOrchestrationQualityState([])).toBeNull();
    expect(normalizeOrchestrationQualityState('shadow')).toBe('shadow');
    expect(normalizeOrchestrationQualityState({ state: 'active' })).toBe('active');
    expect(normalizeOrchestrationQualityState({ result: { state: 'shadow' } })).toBe('shadow');

    expect(orchestrationQualityAffectsRouting(null)).toBe(false);
    expect(orchestrationQualityAffectsRouting('shadow')).toBe(false);
    expect(orchestrationQualityAffectsRouting('active')).toBe(true);
  });

  it('models Workboard to Task Ledger as a one-way reference', () => {
    const reference = createTaskLedgerReference({
      taskLedgerNodeId: 'ledger-node-1',
      workboardCardId: 'card-1',
      source: 'workboard',
    });

    expect(reference).toEqual({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      workboardCardId: 'card-1',
      source: 'workboard',
    });
    expect(reference).not.toHaveProperty('sync');
    expect(reference).not.toHaveProperty('taskLedgerMirror');
  });

  it('normalizes permission decisions without replacing existing permission systems', () => {
    expect(createPermissionDecisionEvent({
      workspaceMode: 'plan',
      role: ' implementer ',
      tool: ' write ',
      boundary: 'user-file',
      decision: 'deny',
      reason: 'Plan mode blocks user file writes',
      requestId: ' request-1 ',
    })).toEqual({
      kind: 'permission-decision',
      workspaceMode: 'plan',
      role: 'implementer',
      tool: 'write',
      boundary: 'user-file',
      decision: 'deny',
      reason: 'Plan mode blocks user file writes',
      requestId: 'request-1',
    });
  });

  it('keeps ordinary Chat to Task Loop as an explicit user-confirmed upgrade suggestion', () => {
    expect(createTaskLoopUpgradeSuggestion({
      sessionId: 'session-1',
      taskTitle: 'Refactor the auth flow',
      reason: 'The task needs checkpoints, evidence gates, and repair semantics.',
    })).toEqual({
      kind: 'task-loop-upgrade-suggestion',
      sessionId: 'session-1',
      taskTitle: 'Refactor the auth flow',
      reason: 'The task needs checkpoints, evidence gates, and repair semantics.',
      requiresUserConfirmation: true,
      createsTaskLedgerRoot: true,
      startsRun: 'after-user-confirmation',
    });
  });

  it('lists the product-positioning claims that public docs must not make', () => {
    expect(PRODUCT_SEMANTIC_UNSAFE_CLAIMS.map((claim) => claim.id)).toEqual([
      'chat-editable-dag',
      'chat-auto-task-loop',
      'team-orchestrate-complete-quality',
      'routing-memo-default-learning',
      'plan-mode-strict-no-diff',
    ]);
  });

  it('assigns every P0 and P1 planning item to an explicit semantic boundary', () => {
    const expectedTaskIds = [
      'P0-00',
      'P0-01',
      'P0-02',
      'P0-03',
      'P0-04',
      'P0-05',
      'P0-06',
      'P0-07',
      'P0-08',
      'P0-09',
      'P0-10',
      'P0-11',
      'P0-12',
      'P0-13',
      'P0-14',
      'P0-15',
      'P0-16',
      'P0-17',
      'P1-01',
      'P1-02',
      'P1-03',
      'P1-04',
      'P1-05',
      'P1-06',
      'P1-07',
      'P1-08',
      'P1-09',
      'P1-10',
      'P1-11',
      'P1-12',
      'P1-13',
      'P1-14',
    ];

    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.map((task) => task.id)).toEqual(expectedTaskIds);

    for (const task of PRODUCT_SEMANTIC_TASK_BOUNDARIES) {
      expect(task.title.trim(), task.id).not.toHaveLength(0);
      expect(task.semanticStatus, task.id).toBe('positioned');
      expect(task.implementationStatus, task.id).toMatch(/^(done|todo|defer)$/);
      expect(task.lane.trim(), task.id).not.toHaveLength(0);
      expect(task.sourceOfTruth.trim(), task.id).not.toHaveLength(0);
      expect(task.safeClaim.trim(), task.id).not.toHaveLength(0);
      expect(task.forbiddenClaim.trim(), task.id).not.toHaveLength(0);
      expect(task.nextAction.trim(), task.id).not.toMatch(/^(待补|todo|tbd)$/i);
      expect(task.boundaryRefs.length, task.id).toBeGreaterThan(0);
    }
  });

  it('marks verified P0/P1 closures done while preserving product boundaries', () => {
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P0-12')).toMatchObject({
      implementationStatus: 'done',
      lane: 'permission-boundary',
      safeClaim: expect.stringContaining('Electron write/edit/exec challenge'),
      forbiddenClaim: expect.stringContaining('exhaustive no-diff'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P0-13')).toMatchObject({
      implementationStatus: 'done',
      lane: 'permission-boundary',
      safeClaim: expect.stringContaining('PermissionDecisionEvent'),
      forbiddenClaim: expect.stringContaining('exhaustively covers every permission surface'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-02')).toMatchObject({
      implementationStatus: 'done',
      lane: 'chat-plan',
      safeClaim: expect.stringContaining('lightweight'),
      forbiddenClaim: expect.stringContaining('full drag-and-drop DAG editor'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-03')).toMatchObject({
      implementationStatus: 'done',
      lane: 'task-ledger-workboard',
      safeClaim: expect.stringContaining('one-way TaskLedgerReference'),
      forbiddenClaim: expect.stringContaining('two-way task system'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-04')).toMatchObject({
      implementationStatus: 'done',
      lane: 'orchestration-quality',
      safeClaim: expect.stringContaining('shadow quality scorecard'),
      forbiddenClaim: expect.stringContaining('complete quality product'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-05')).toMatchObject({
      implementationStatus: 'done',
      lane: 'orchestration-diagnostics',
      safeClaim: expect.stringContaining('diagnostic recommendations'),
      forbiddenClaim: expect.stringContaining('Task Loop repair/blocked semantics'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-06')).toMatchObject({
      implementationStatus: 'done',
      lane: 'routing-memo',
      safeClaim: expect.stringContaining('shadow'),
      forbiddenClaim: expect.stringContaining('default learning'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-07')).toMatchObject({
      implementationStatus: 'done',
      lane: 'routing-memo',
      safeClaim: expect.stringContaining('same-session Task Loop scorecard authority'),
      forbiddenClaim: expect.stringContaining('caller-supplied qualityState'),
    });
    expect(PRODUCT_SEMANTIC_TASK_BOUNDARIES.find((task) => task.id === 'P1-08')).toMatchObject({
      implementationStatus: 'done',
      lane: 'chat-to-task-loop',
      safeClaim: expect.stringContaining('upgrade suggestion'),
      forbiddenClaim: expect.stringContaining('automatically starts Task Loop'),
    });
  });
});

describe('ClawX product semantic relation contract (ProductSemanticRelations/v1)', () => {
  const UMBRELLA_NEGATIVE_ROWS = [1, 2, 3, 4, 5, 6, 7, 8];

  it('pins the contract version and a closed rule set of twelve rules', () => {
    expect(PRODUCT_SEMANTIC_CONTRACT_VERSION).toBe('ProductSemanticRelations/v1');
    expect(PRODUCT_SEMANTIC_RELATION_RULES).toEqual([
      'unknown-endpoint',
      'unknown-kind',
      'unknown-authority-boundary',
      'self-loop',
      'duplicate-relation',
      'missing-evidence',
      'kind-boundary-mismatch',
      'relation-endpoint-mismatch',
      'reverse-task-authority',
      'forged-grant-field',
      'cross-session-quality',
      'unsupported-contract-version',
    ]);
    expect(new Set(PRODUCT_SEMANTIC_RELATION_RULES).size).toBe(PRODUCT_SEMANTIC_RELATION_RULES.length);
  });

  it('derives relationKey from from--kind--to and writes ? for unreadable parts', () => {
    expect(relationKey({ from: 'chat', kind: 'projects', to: 'task-ledger' })).toBe('chat--projects--task-ledger');
    expect(relationKey({ from: 'chat', kind: '', to: 'task-ledger' })).toBe('chat--?--task-ledger');
    expect(relationKey({} as { from: string; kind: string; to: string })).toBe('?--?--?');
    expect(relationKey(null as unknown as { from: string; kind: string; to: string })).toBe('?--?--?');
    expect(PRODUCT_SEMANTIC_RELATIONS.map((relation) => relationKey(relation))).toEqual([
      'chat--suggests-upgrade-to--task-loop',
      'chat--projects--task-ledger',
      'chat-plan--projects--task-ledger',
      'task-loop--roots-in--task-ledger',
      'workboard--references-one-way--task-ledger',
      'routing-memo--quality-gated-by--task-loop',
    ]);
  });

  it('accepts the live PRODUCT_SEMANTIC_RELATIONS as the positive case without copying them', () => {
    expect(validateProductSemanticRelations(PRODUCT_SEMANTIC_RELATIONS)).toEqual({ ok: true, diagnostics: [] });
    expect(validateProductSemanticRelations(PRODUCT_SEMANTIC_RELATIONS, {
      contractVersion: PRODUCT_SEMANTIC_CONTRACT_VERSION,
      sessionScope: 'same-session',
    })).toEqual({ ok: true, diagnostics: [] });
    for (const relation of PRODUCT_SEMANTIC_RELATIONS) {
      expect(validateProductSemanticRelation(relation), relationKey(relation)).toEqual([]);
    }
  });

  it('accepts an empty declaration set (Plan Mode declares no relation)', () => {
    expect(validateProductSemanticRelations([])).toEqual({ ok: true, diagnostics: [] });
    expect(PRODUCT_SEMANTIC_RELATIONS.some(({ from, to }) => String(from) === 'plan-mode' || String(to) === 'plan-mode')).toBe(false);
  });

  it('accepts only the six specified domain/range pairs across all known concepts and relation kinds', () => {
    const allowed = new Set([
      'chat--suggests-upgrade-to--task-loop',
      'chat--projects--task-ledger',
      'chat-plan--projects--task-ledger',
      'task-loop--roots-in--task-ledger',
      'workboard--references-one-way--task-ledger',
      'routing-memo--quality-gated-by--task-loop',
    ]);
    const kinds = new Map(PRODUCT_SEMANTIC_RELATIONS.map((relation) => [relation.kind, relation.authorityBoundary]));
    for (const [kind, authorityBoundary] of kinds) {
      for (const { id: from } of PRODUCT_SEMANTIC_CONCEPTS) {
        for (const { id: to } of PRODUCT_SEMANTIC_CONCEPTS) {
          const candidate = { from, kind, to, authorityBoundary, evidenceRefs: ['docs/clawx-product-semantics.md'] };
          expect(validateProductSemanticRelation(candidate).length === 0, relationKey(candidate)).toBe(allowed.has(relationKey(candidate)));
        }
      }
    }
  });

  it('loads negative fixtures from disk with the ProductSemanticRelationFixture/v1 schema', () => {
    expect(NEGATIVE_FIXTURES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(NEGATIVE_FIXTURES.map((fixture) => fixture.id)).size).toBe(NEGATIVE_FIXTURES.length);
    for (const fixture of NEGATIVE_FIXTURES) {
      expect(fixture.id.trim(), fixture.id).not.toHaveLength(0);
      expect(fixture).toHaveProperty('candidate');
      expect(PRODUCT_SEMANTIC_RELATION_RULES, fixture.id).toContain(fixture.expect.rule);
      expect(fixture.expect.field.trim(), fixture.id).not.toHaveLength(0);
      expect(Array.isArray(fixture.umbrellaRow), fixture.id).toBe(true);
    }
  });

  it('covers every umbrella step-two negative row and every rule with at least one fixture', () => {
    const coveredRows = new Set(NEGATIVE_FIXTURES.flatMap((fixture) => fixture.umbrellaRow));
    for (const row of UMBRELLA_NEGATIVE_ROWS) {
      expect(coveredRows.has(row), `umbrella negative row ${row}`).toBe(true);
    }
    const coveredRules = new Set(NEGATIVE_FIXTURES.map((fixture) => fixture.expect.rule));
    for (const rule of PRODUCT_SEMANTIC_RELATION_RULES) {
      expect(coveredRules.has(rule), rule).toBe(true);
    }
  });

  for (const fixture of NEGATIVE_FIXTURES) {
    it(`rejects negative fixture "${fixture.id}" via rule ${fixture.expect.rule} on field ${fixture.expect.field}`, () => {
      const diagnostics = runFixture(fixture);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics).toContainEqual(expect.objectContaining({
        rule: fixture.expect.rule,
        field: fixture.expect.field,
        relationKey: expect.any(String),
        message: expect.stringMatching(/\S/),
      }));
      for (const diagnostic of diagnostics) {
        expect(PRODUCT_SEMANTIC_RELATION_RULES, fixture.id).toContain(diagnostic.rule);
        expect(Object.keys(diagnostic).sort(), fixture.id).toEqual(['field', 'message', 'relationKey', 'rule']);
      }
      if (Array.isArray(fixture.candidate)) {
        expect(validateProductSemanticRelations(fixture.candidate, fixture.context).ok).toBe(false);
      } else {
        expect(validateProductSemanticRelations([fixture.candidate], fixture.context).ok).toBe(false);
      }
    });
  }

  it('rejects the individually legal but mismatched combination, not only unknown enum members', () => {
    const diagnostics = validateProductSemanticRelation({
      from: 'chat',
      kind: 'projects',
      to: 'task-ledger',
      authorityBoundary: 'advisory-only',
      evidenceRefs: ['docs/clawx-product-semantics.md'],
    });
    expect(diagnostics.map(({ rule }) => rule)).toEqual(['kind-boundary-mismatch']);
    expect(diagnostics[0]).toMatchObject({ relationKey: 'chat--projects--task-ledger', field: 'authorityBoundary' });
  });

  it('keeps the same relation valid in a same-session context and shadow in a cross-session context', () => {
    const memo = PRODUCT_SEMANTIC_RELATIONS.find(({ kind }) => kind === 'quality-gated-by')!;
    expect(validateProductSemanticRelation(memo, { sessionScope: 'same-session' })).toEqual([]);
    expect(validateProductSemanticRelation(memo, { sessionScope: 'cross-session' }).map(({ rule }) => rule))
      .toEqual(['cross-session-quality']);
  });

  it('does not interpret an unsupported contract version as latest', () => {
    const [relation] = PRODUCT_SEMANTIC_RELATIONS;
    expect(validateProductSemanticRelation(relation, { contractVersion: PRODUCT_SEMANTIC_CONTRACT_VERSION })).toEqual([]);
    expect(validateProductSemanticRelation(relation, { contractVersion: 'ProductSemanticRelations/v0' })).toEqual([
      expect.objectContaining({ rule: 'unsupported-contract-version', field: 'contractVersion', relationKey: relationKey(relation) }),
    ]);
  });

  it('exports only pure functions: the module performs no validation at import time', () => {
    const source = readFileSync(path.join(ROOT, 'shared/product-semantics.ts'), 'utf8');
    const topLevelCall = /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*validateProductSemanticRelations?\(|^validateProductSemanticRelations?\(/m;
    expect(source).not.toMatch(topLevelCall);
    expect(source).toMatch(/^export const PRODUCT_SEMANTIC_CONTRACT_VERSION = 'ProductSemanticRelations\/v1' as const;$/m);
    expect(source).toMatch(/^export function relationKey\(/m);
    expect(source).toMatch(/^export function validateProductSemanticRelation\(/m);
    expect(source).toMatch(/^export function validateProductSemanticRelations\(/m);
  });
});
