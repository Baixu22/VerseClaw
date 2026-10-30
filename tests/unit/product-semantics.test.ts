import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sources from '../../harness/specs/fixtures/ontology-lite-existing-contracts/sources.json';
import validRelations from '../../harness/specs/fixtures/ontology-lite-existing-contracts/relations.valid.json';
import invalidRelations from '../../harness/specs/fixtures/ontology-lite-existing-contracts/relations.invalid.json';
import {
  PRODUCT_SEMANTIC_CONCEPTS,
  PRODUCT_SEMANTIC_RELATIONS,
  PRODUCT_SEMANTIC_TASK_BOUNDARIES,
  PRODUCT_SEMANTIC_UNSAFE_CLAIMS,
  createPermissionDecisionEvent,
  createTaskLedgerReference,
  createTaskLoopUpgradeSuggestion,
  normalizeOrchestrationQualityState,
  orchestrationQualityAffectsRouting,
  validateProductSemanticRelations,
} from '@shared/product-semantics';

describe('ClawX product semantics', () => {
  it('accepts the six existing relations and independent static same-session/identity declarations', () => {
    expect(validateProductSemanticRelations(PRODUCT_SEMANTIC_RELATIONS).valid).toBe(true);
    const before = JSON.stringify(validRelations);
    const result = validateProductSemanticRelations(validRelations.relations, validRelations.context);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.unverified).toEqual([expect.stringContaining('no owner-store')]);
    expect(result).not.toHaveProperty('grant');
    expect(JSON.stringify(validRelations)).toBe(before);
    expect(PRODUCT_SEMANTIC_RELATIONS.some(row => String(row.from) === 'plan-mode')).toBe(false);
  });

  it('preserves owner-resolved legacy workspace compatibility and task completion facts', () => {
    const result = validateProductSemanticRelations(validRelations.relations, {
      scope: { runId: 'attempt-one', scope: { workspaceKey: 'workspace-one' } },
      taskReference: { kind: 'ledger', taskNodeId: 'ledger-one' },
      completion: { taskStatus: 'completed', authority: 'task-ledger' },
    });
    expect(result.valid).toBe(true);
    expect(result).not.toHaveProperty('grant');
  });

  it.each(invalidRelations.cases)('rejects independent $id at its declared rule/field', fixture => {
    const before = JSON.stringify(fixture);
    const result = validateProductSemanticRelations(fixture.relations, fixture.context);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining(fixture.expected)]));
    for (const diagnostic of result.diagnostics) {
      for (const value of Object.values(diagnostic)) expect(value.trim().length).toBeGreaterThan(0);
    }
    expect(result).not.toHaveProperty('grant');
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it('maps every derived relation key to source anchors, consumers and bounded regressions', () => {
    expect(sources.relations.map(({ relationKey }) => relationKey)).toEqual(
      PRODUCT_SEMANTIC_RELATIONS.map(({ from, kind, to }) => `${from}:${kind}:${to}`),
    );
    for (const relation of sources.relations) {
      expect(relation.documentation.length, relation.relationKey).toBeGreaterThan(0);
      expect(relation.owners.length, relation.relationKey).toBeGreaterThan(0);
      expect(relation.valueConsumers).toEqual(['tests/unit/product-semantics.test.ts', 'scripts/check-evidence-refs.mjs']);
      expect(relation.regressions.length).toBeGreaterThan(0);
      expect(relation.unverified.length).toBeGreaterThan(0);
      for (const { path, locator } of [...relation.documentation, ...relation.owners]) {
        expect(readFileSync(resolve(process.cwd(), path), 'utf8'), path).toContain(locator);
      }
    }
    for (const boundary of sources.boundaries) {
      for (const { path, locator } of boundary.sources) {
        expect(readFileSync(resolve(process.cwd(), path), 'utf8'), path).toContain(locator);
      }
    }
    expect(sources.consumerSearch.productionValueConsumers).toEqual([]);
  });

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
