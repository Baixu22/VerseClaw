// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildLongSessionContinuityContext, renderLongSessionContinuityContext } from '../../shared/long-session-continuity';
import { normalizeContextSemanticState } from '../../shared/types/context-item';
import { emptyTaskLedgerWorkingContextSnapshot, workingContextSemanticState } from '../../shared/task-ledger-working-context';
import type { TaskLedgerWorkingContextAcceptedRecord } from '../../shared/types/task-ledger';
import {
  buildDeterministicCompressionArtifact, normalizeCompressionArtifact,
  renderCompressionArtifactSummary, renderRecoveryContextProjection,
  type CompressionArtifact, type CompressionSemanticAtom,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import { bindCompactionDetailsArchiveEvidence, buildPreviousCompactionLedgerMessage } from '../../openclaw_runtime/src/agents/agent-hooks/compaction-addressability';
import { createContextArchiveHandleForPayloadSync, createContextItemId, verifyContextArchiveHandle } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';

const owners = vi.hoisted(() => ({ binding: vi.fn(), working: vi.fn() }));
vi.mock('../../electron/services/workspaces-api', () => ({ getPersistedCoordinatorBinding: owners.binding }));
vi.mock('../../electron/services/task-ledger-service', () => ({ loadTaskLedgerSnapshot: async () => ({
  schemaVersion: 1, workspaceId: 'ws', nodes: [], edges: [], sessionLinks: [], eventsCount: 0,
}) }));
vi.mock('../../electron/services/task-ledger-working-context', () => ({ readTaskLedgerWorkingContext: owners.working }));
vi.mock('../../electron/utils/store', () => ({ getSetting: async () => true }));
vi.mock('../../electron/utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../electron/services/resource-tracker', () => ({ getResourceTracker: vi.fn() }));
vi.mock('../../electron/utils/token-usage', () => ({ getSessionTokenUsageSummary: vi.fn() }));
vi.mock('../../electron/services/mock-provider', () => ({ handleMockChatSend: vi.fn() }));
vi.mock('../../electron/services/task-system-service', () => ({ persistentTaskChatContext: vi.fn() }));
vi.mock('../../electron/services/knowledge-read-scope', () => ({ prepareKnowledgeReadScope: vi.fn(), assertKnowledgeReadScopeCurrent: vi.fn() }));

const SESSION = 'agent:main:c02';
const OUTPUT = process.env.CLAWX_C02_OUTPUT || mkdtempSync(join(tmpdir(), 'autonomy-context-c02-'));
mkdirSync(OUTPUT, { recursive: true });
if (existsSync(join(OUTPUT, 'state-preservation-cases.json'))) throw new Error('C02_RUN_ALREADY_EXISTS');
const cases: unknown[] = [];
const mapping: unknown[] = [];
const legacy: unknown[] = [];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const INPUT = { sessionKey: SESSION, workspaceId: 'ws', bindingRevision: 1, activeTaskNodeId: 'task-1', now: 1_000 };

function atom(overrides: Partial<CompressionSemanticAtom> = {}): CompressionSemanticAtom {
  return {
    id: 'a1', type: 'decision', canonicalIdentity: 'decision-1', severity: 'critical', confidence: 1,
    scope: 'task:task-1', polarity: 'negative', status: 'verified', text: 'probe-A',
    evidenceRefs: [{ type: 'tool', ref: 'result:probe-A' }],
    source: { kind: 'message', ref: 'message:source' }, updatedAt: 123, ...overrides,
  };
}

function build(atoms: CompressionSemanticAtom[] = []) {
  return buildDeterministicCompressionArtifact({
    messages: [], semanticAtoms: atoms, summary: '## Goal\nComplete task.\n## Next Steps\n1. Inspect result.',
  });
}

async function preview(artifact: unknown) {
  owners.binding.mockResolvedValue({ workspaceId: 'ws', sessionKey: SESSION, agentId: 'main', state: 'active',
    sessionGeneration: 'g1', bindingRevision: 1, environment: { canonicalRoot: OUTPUT },
    activeTaskNodeId: 'task-1', taskLedgerReferences: [] });
  owners.working.mockResolvedValue(emptyTaskLedgerWorkingContextSnapshot());
  const rpc = vi.fn(async (method: string) => {
    if (method === 'sessions.describe') return { session: { sessionId: 'g1' } };
    if (method === 'sessions.compressionArtifact') return { checkpointId: 'checkpoint', artifact };
    if (method === 'memory.surface') return { accepted: [], candidates: [], counts: { modelVisible: 0 } };
    if (method === 'session.activitySnapshot') return {};
    throw new Error(`unexpected owner call: ${method}`);
  });
  const { createChatApi } = await import('../../electron/services/chat-api');
  return createChatApi({ gatewayManager: { rpc } as never }).continuityPreview({
    sessionKey: SESSION, workspaceId: 'ws', activeTaskNodeId: 'task-1',
  });
}

describe('C02 semantic state through compression, Main RPC and recovery', () => {
  it.each([
    ['verified', true, 'verified'], ['verified', false, 'unknown'],
    ['unverified', true, 'unverified'], ['confirmed', true, 'unknown'],
    ['agent_approved', true, 'unknown'], ['future-owner-state', true, 'unknown'],
    ['stale', true, 'unknown'], ['superseded', true, 'unknown'],
  ] as const)('maps owner state %s with evidence=%s to %s', (sourceStatus, hasEvidence, expected) => {
    const result = normalizeContextSemanticState({ owner: 'compression-artifact', sourceStatus,
      polarity: 'negative', scope: 'turn:1', evidenceRefs: hasEvidence ? [{ type: 'tool', ref: 'r1' }] : [] });
    expect(result.verification).toBe(expected);
    expect(result.sourceStatus).toBe(sourceStatus);
    expect(normalizeContextSemanticState(JSON.parse(JSON.stringify(result)))).toEqual(result);
    mapping.push({ sourceStatus, hasEvidence, expected, observed: result });
  });

  it('preserves accepted Working Context provenance and revision without claiming verification', () => {
    const current: TaskLedgerWorkingContextAcceptedRecord = {
      proposalId: 'p2', field: 'Constraints', value: ['Use JSON.'], version: 2, actor: 'assistant',
      evidenceRefs: [{ type: 'session', ref: 'user-revision-2' }],
      ttl: { issuedAt: '2026-11-26T00:00:00Z', expiresAt: '2026-11-27T00:00:00Z' },
      sensitivity: 'workspace', trust: 'confirmed', taskId: 'task-1', eventId: 'e2',
      createdAt: '2026-11-26T00:00:00Z', acceptedEventId: 'accepted-e2',
      policyDigest: `sha256:${'a'.repeat(64)}`, acceptedAt: '2026-11-26T00:00:01Z',
    };
    const result = workingContextSemanticState(current, [{ ...current, proposalId: 'p1', version: 1 }],
      [{ ...current, proposalId: 'conflict', trust: 'proposed' }]);
    expect(result).toMatchObject({ sourceStatus: 'confirmed', verification: 'unknown', polarity: 'unknown',
      sourceRef: 'accepted-e2', sourceVersion: '2', scope: 'task:task-1', supersedes: ['p1'], conflicts: ['conflict'] });
    expect(result.evidenceRefs).toEqual(current.evidenceRefs);
    const workingContext = emptyTaskLedgerWorkingContextSnapshot();
    workingContext.fields.Constraints.current = current;
    const pack = buildLongSessionContinuityContext({ ...INPUT, workingContext, now: Date.parse('2026-11-26T01:00:00Z') });
    expect(pack.items[0].semantic?.verification).toBe('unknown');
    expect(renderLongSessionContinuityContext(pack)).toContain('sourceStatus=confirmed; verification=unknown');
    for (const length of [156, 256, 512]) {
      const taskId = 't'.repeat(length);
      workingContext.fields.Constraints.current = { ...current, taskId };
      const longIdPack = buildLongSessionContinuityContext({ ...INPUT, activeTaskNodeId: taskId,
        workingContext, budgetChars: 4_000, now: Date.parse('2026-11-26T01:00:00Z') });
      expect(longIdPack.items[0].semantic?.scope).toBe(`task:${taskId}`);
    }
    mapping.push({ owner: 'working-context', observed: result });
  });

  it.each(['revision', 'negative', 'temporary'] as const)('preserves %s through three compression/RPC/disk cycles', async (kind) => {
    let artifact = build([kind === 'revision'
      ? atom({ id: 'old', type: 'constraint', polarity: 'positive', text: 'Use CSV.' })
      : kind === 'temporary'
        ? atom({ type: 'constraint', polarity: 'positive', scope: 'turn:1', text: 'Use bullets.' })
        : atom()]);
    const observations = [];
    for (let cycle = 1; cycle <= 3; cycle++) {
      artifact = buildDeterministicCompressionArtifact({ messages: [], previousArtifact: artifact,
        summary: renderCompressionArtifactSummary(artifact),
        ...(kind === 'revision' && cycle === 1 ? { semanticAtoms: [atom({ id: 'new', type: 'constraint',
          polarity: 'positive', text: 'Use JSON.', supersedes: ['old'], conflicts: ['alternate'],
          evidenceRefs: [{ type: 'session', ref: 'user-revision-2' }] })] } : {}),
      });
      const archive = createContextArchiveHandleForPayloadSync({ sessionId: SESSION,
        itemId: createContextItemId('c02', kind, String(cycle)), payload: artifact, archiveRoot: join(OUTPUT, 'archives') });
      expect((await verifyContextArchiveHandle(archive)).ok).toBe(true);
      artifact = bindCompactionDetailsArchiveEvidence({ details: { artifact }, archiveHandle: archive })!.artifact as CompressionArtifact;
      const path = join(OUTPUT, `${kind}-${cycle}.json`);
      writeFileSync(path, JSON.stringify(artifact));
      const restored = normalizeCompressionArtifact(JSON.parse(readFileSync(path, 'utf8')))!;
      expect(restored.semanticAtoms).toEqual(normalizeCompressionArtifact(artifact)!.semanticAtoms);
      const result = await preview(restored);
      expect(result.validation).toBe('current');
      const item = result.pack!.items.find((item) => item.id === `compression-atom:${kind === 'revision' ? 'new' : 'a1'}`);
      const expected = restored.semanticAtoms!.find((value) => value.id === (kind === 'revision' ? 'new' : 'a1'))!;
      if (kind !== 'temporary') {
        expect(item).toBeDefined();
        expect(item!.semantic).toMatchObject({ sourceStatus: expected.status, polarity: expected.polarity,
          scope: expected.scope, evidenceRefs: expected.evidenceRefs, sourceRef: expected.source!.ref, sourceVersion: '123',
          supersedes: expected.supersedes ?? [], conflicts: expected.conflicts ?? [] });
      }
      const projection = renderRecoveryContextProjection(restored);
      expect(projection).toContain(`polarity=${expected.polarity}; scope=${expected.scope}`);
      const redistillation = JSON.stringify(buildPreviousCompactionLedgerMessage({ previousArtifact: restored, maxChars: 8_000 }));
      expect(redistillation).toContain(`polarity=${expected.polarity}; scope=${expected.scope}`);
      expect(redistillation).toContain(`id=${expected.id}`);
      if (kind === 'revision') {
        expect(result.pack!.items.some((item) => item.text === 'Use CSV.')).toBe(false);
        expect(restored.semanticAtoms!.find((value) => value.id === 'old')!.status).toBe('superseded');
      } else if (kind === 'temporary') {
        expect(expected.scope).toBe('turn:1');
        expect(item).toBeUndefined();
        expect(result.pack!.exclusions).toContainEqual({ ref: 'compression-atom:a1', reason: 'unknown-scope' });
        expect(result.pack!.items.some(item => item.text === 'Use bullets.')).toBe(false);
        expect(projection).toContain('applicability=unconfirmed-turn');
      } else {
        expect(item!.polarity).toBe('negative');
        expect(result.rendered).toContain('polarity=negative');
      }
      // Execute the scripted consumer's next step from the restored state.
      // The expected result is checked separately from the transition code.
      const action = kind === 'negative' ? (item!.polarity === 'negative' ? 'probe-B' : 'probe-A')
        : kind === 'temporary' ? (item ? 'bullets' : 'prose')
          : item!.text === 'Use JSON.' ? 'json' : 'csv';
      const resultPath = join(OUTPUT, `${kind}-${cycle}-result.txt`);
      writeFileSync(resultPath, action);
      expect(readFileSync(resultPath, 'utf8')).toBe(kind === 'negative' ? 'probe-B' : kind === 'temporary' ? 'prose' : 'json');
      observations.push({ cycle, action, resultSha256: hash(readFileSync(resultPath, 'utf8')),
        artifactSha256: hash(readFileSync(path, 'utf8')), retainedAtom: expected, item: item ?? null,
        exclusions: result.pack!.exclusions, rendered: result.rendered, projection, redistillation, archive });
      artifact = restored;
    }
    cases.push({ kind, cycles: observations });
  });

  it('retains unknown owner labels through RPC and repeated normalization', async () => {
    let stored: unknown = { ...build(), semanticAtoms: [{ ...atom(), status: 'agent_approved' }] };
    for (let i = 0; i < 3; i++) stored = normalizeCompressionArtifact(JSON.parse(JSON.stringify(stored)));
    const result = await preview(stored);
    const item = result.pack!.items.find(item => item.id === 'compression-atom:a1')!;
    expect(item.semantic).toMatchObject({ sourceStatus: 'agent_approved', verification: 'unknown' });
    cases.push({ kind: 'unknown-owner', item });
  });

  it('keeps independent legacy facts and per-item references beside semantic atoms', async () => {
    const artifact = build([atom({ type: 'failed_attempt' })]);
    artifact.blocked = [{ text: 'Await unknown effect reconciliation.', evidenceRefs: [{ type: 'tool', ref: 'effect-unknown' }] }];
    artifact.constraints = [{ text: 'Do not repeat the effect.', evidenceRefs: [{ type: 'session', ref: 'user-constraint' }] }];
    const result = await preview(artifact);
    expect(result.validation).toBe('current');
    expect(result.pack!.items.find(item => item.text === artifact.blocked[0].text)?.evidenceRefs).toEqual(['tool:effect-unknown']);
    expect(result.pack!.items.find(item => item.text === artifact.constraints[0].text)?.evidenceRefs).toEqual(['session:user-constraint']);
    const projection = renderRecoveryContextProjection(artifact);
    expect(projection).toContain('Await unknown effect reconciliation.');
    expect(projection).toContain('Do not repeat the effect.');
    legacy.push({ kind: 'mixed-records', pack: result.pack, projection });
  });

  it('keeps opposite decisions with the same text distinct and excludes foreign or retired records', () => {
    const atoms = [atom(), atom({ id: 'positive', polarity: 'positive' }),
      atom({ id: 'foreign', scope: 'task:other', text: 'foreign' }),
      atom({ id: 'retired', status: 'superseded', text: 'retired' })];
    const pack = buildLongSessionContinuityContext({ ...INPUT, compression: {
      semanticAtoms: atoms, decisions: atoms.map(atom => ({ text: atom.text,
        evidenceRefs: atom.evidenceRefs.map(ref => `${ref.type}:${ref.ref}`) })),
    } });
    expect(pack.items.map(item => item.polarity)).toEqual(['negative', 'positive']);
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      { ref: 'compression-atom:foreign', reason: 'out-of-scope' },
      { ref: 'compression-atom:retired', reason: 'revoked-or-superseded' },
    ]));
    cases.push({ kind: 'scope-and-opposition', pack });
  });

  it.each(['task', 'workspace', 'agent', 'role', 'project:other', 'future:owner', 'user:other', 'global'])(
    'excludes unsupported or unbound scope %s from active continuity', async scope => {
      const result = await preview(build([atom({ scope })]));
      expect(result.pack!.items.some(item => item.id === 'compression-atom:a1')).toBe(false);
      expect(result.pack!.items.some(item => item.text === 'probe-A')).toBe(false);
      expect(result.pack!.exclusions).toContainEqual({ ref: 'compression-atom:a1', reason: 'unknown-scope' });
      cases.push({ kind: 'unbound-scope', scope, exclusions: result.pack!.exclusions });
    });

  it.each(['constraint', 'decision', 'next_action'] as const)('excludes every legacy mirror of scoped %s with eight references', async type => {
    for (const scope of ['turn:1', 'task:other']) {
      const source = atom({ type, scope, text: `Scoped ${type}.`,
        evidenceRefs: Array.from({ length: 8 }, (_, i) => ({ type: 'tool' as const, ref: `result-${i}` })) });
      const artifact = build([source]);
      const restored = normalizeCompressionArtifact(JSON.parse(JSON.stringify(artifact)))!;
      const result = await preview(restored);
      expect(result.pack!.items.some(item => item.text === source.text)).toBe(false);
      const projection = renderRecoveryContextProjection(restored);
      expect(projection).toContain(`scope=${scope}`);
      expect(projection).not.toContain(`constraints:\n- ${source.text}`);
      expect(projection).not.toContain(`decisions:\n- ${source.text}`);
      expect(projection).not.toContain(`active:\n- ${source.text}`);
      cases.push({ kind: 'scoped-eight-reference-mirrors', type, scope, pack: result.pack, projection });
    }
  });

  it.each(['constraint', 'decision', 'next_action'] as const)('preserves %s origin through actual archive binding and v1 readback', async type => {
    const artifact = build([atom({ type, scope: 'turn:1', text: `Archived ${type}.` })]);
    const handle = createContextArchiveHandleForPayloadSync({ sessionId: SESSION, itemId: createContextItemId('archive-origin', type),
      payload: artifact, archiveRoot: join(OUTPUT, 'archives') });
    expect((await verifyContextArchiveHandle(handle)).ok).toBe(true);
    for (const legacyFormat of [false, true]) {
      const source = JSON.parse(JSON.stringify(artifact)) as CompressionArtifact;
      if (legacyFormat) {
        delete source.semanticOrigins;
        for (const items of [source.constraints, source.decisions, source.inProgress]) {
          for (const item of items) delete item.semanticAtomId;
        }
      }
      const bound = bindCompactionDetailsArchiveEvidence({ details: { artifact: source }, archiveHandle: handle })!;
      const restored = normalizeCompressionArtifact(JSON.parse(JSON.stringify(bound.artifact)))!;
      const result = await preview(restored);
      expect(restored.semanticAtoms![0].evidenceRefs[0].type).toBe('archive');
      expect(result.pack!.items.some(item => item.text === `Archived ${type}.`)).toBe(false);
      const projection = renderRecoveryContextProjection(restored);
      expect(projection).toContain('applicability=unconfirmed-turn');
      expect(projection).not.toContain(`currentState: Archived ${type}.`);
      const message = buildPreviousCompactionLedgerMessage({ previousArtifact: restored, maxChars: 200 });
      if (message?.role !== 'user') throw new Error('Expected a user-role compaction ledger');
      const text = (message.content as Array<{ type: string; text: string }>)[0].text;
      expect(text.length).toBeLessThanOrEqual(200);
      expect(text).toContain('records omitted');
      cases.push({ kind: 'archive-origin', type, legacyFormat, handle, pack: result.pack, projection });
    }
  });

  it('requires the session owner read to resolve shorthand session scope and rejects missing scope', async () => {
    const artifact = build([atom({ scope: 'session' })]);
    const unbound = buildLongSessionContinuityContext({ ...INPUT, compression: { semanticAtoms: artifact.semanticAtoms } });
    expect(unbound.items).toEqual([]);
    const bound = await preview(artifact);
    expect(bound.pack!.items.find(item => item.id === 'compression-atom:a1')?.scope).toEqual({ kind: 'session', key: SESSION });
    const missing = await preview({ ...artifact, semanticAtoms: [{ ...atom(), scope: undefined }] });
    expect(missing.pack!.items.some(item => item.id === 'compression-atom:a1')).toBe(false);
    expect(missing.pack!.exclusions).toContainEqual({ ref: 'compression-atom:a1', reason: 'unknown-scope' });
    cases.push({ kind: 'session-owner-scope', unbound, bound: bound.pack, missing: missing.pack });
  });

  it.each([156, 256, 512])('preserves a %s-character task ID through compression scope and continuity', length => {
    const taskId = 't'.repeat(length);
    const artifact = normalizeCompressionArtifact(JSON.parse(JSON.stringify(build([atom({
      type: 'constraint', scope: `task:${taskId}`, text: 'Keep the long task constraint.',
    })]))))!;
    expect(artifact.semanticAtoms![0].scope).toBe(`task:${taskId}`);
    const pack = buildLongSessionContinuityContext({ ...INPUT, activeTaskNodeId: taskId, budgetChars: 4_000,
      compression: { semanticAtoms: artifact.semanticAtoms } });
    expect(pack.items[0].semantic?.scope).toBe(`task:${taskId}`);
    expect(pack.items[0].scope.key).toBe(taskId);
    cases.push({ kind: 'long-task-id', length, pack });
  });

  it('keeps identical legacy text when its field or evidence belongs to a different record', async () => {
    const artifact = build([atom({ id: 'retired', status: 'superseded', text: 'Shared text.' })]);
    artifact.objective = 'Shared text.';
    artifact.nextAction = 'Shared text.';
    artifact.constraints = [{ text: 'Shared text.', evidenceRefs: [{ type: 'session', ref: 'new-constraint' }] }];
    artifact.decisions = [{ text: 'Shared text.', evidenceRefs: [{ type: 'session', ref: 'new-decision' }] }];
    const result = await preview(artifact);
    expect(result.pack!.items.map(item => item.kind)).toEqual(expect.arrayContaining(['objective', 'constraint', 'decision', 'next-action']));
    expect(result.pack!.items.find(item => item.kind === 'decision')?.evidenceRefs).toEqual(['session:new-decision']);
    const projection = renderRecoveryContextProjection(artifact);
    expect(projection).toContain('objective: Shared text.');
    expect(projection).toContain('nextAction: Shared text.');
    expect(projection).toContain('constraints:\n- Shared text.');
    expect(projection).toContain('decisions:\n- Shared text.');
    cases.push({ kind: 'distinct-records-same-text', pack: result.pack, projection });
  });

  it('preserves separate references for equal-text legacy facts', async () => {
    const artifact = build();
    artifact.constraints = ['user-a', 'user-b'].map(ref => ({ text: 'Use JSON.', evidenceRefs: [{ type: 'session', ref }] }));
    const result = await preview(artifact);
    expect(result.pack!.items.filter(item => item.kind === 'constraint').map(item => item.evidenceRefs))
      .toEqual([['session:user-a'], ['session:user-b']]);
    legacy.push({ kind: 'same-text-distinct-evidence', pack: result.pack });
  });

  it('retains independent old string fields that collide with excluded scoped atoms', async () => {
    const result = await preview({ constraints: ['Use bullets.'], objective: 'Keep the ongoing goal.',
      semanticAtoms: [atom({ type: 'constraint', scope: 'turn:1', text: 'Use bullets.' }),
        atom({ id: 'temporary-goal', type: 'goal', scope: 'task:other', text: 'Keep the ongoing goal.' })] });
    expect(result.pack!.items.find(item => item.kind === 'constraint')).toMatchObject({ text: 'Use bullets.', scope: { kind: 'session' } });
    expect(result.pack!.items.find(item => item.kind === 'objective')).toMatchObject({ text: 'Keep the ongoing goal.', scope: { kind: 'session' } });
    expect(result.pack!.items.every(item => item.semantic === undefined)).toBe(true);
    legacy.push({ kind: 'independent-string-collision', pack: result.pack });
  });

  it('rejects unresolved semantic links after real checkpoint atom truncation', async () => {
    const previous = build(Array.from({ length: 48 }, (_, i) => atom({ id: `old-${i}`, type: 'entity',
      severity: 'nice_to_have', text: `Old observation ${i}.` })));
    const built = buildDeterministicCompressionArtifact({ messages: [], previousArtifact: previous, semanticAtoms: [
      atom({ id: 'late-constraint', type: 'constraint', scope: 'turn:1', text: 'Never promote missing constraint.' }),
      atom({ id: 'late-next', type: 'next_action', scope: 'task:other', text: 'Never promote missing action.' }),
    ] });
    const restored = normalizeCompressionArtifact(JSON.parse(JSON.stringify(built)))!;
    expect(restored.semanticAtoms).toHaveLength(48);
    expect(restored.quality.warnings).toContain('semantic_atom_limit_exceeded');
    const result = await preview(restored);
    expect(result.validation).toBe('invalidated');
    expect(result.reason).toBe('critical_context_budget_exceeded');
    expect(result.pack!.items.some(item => item.text.startsWith('Never promote'))).toBe(false);
    expect(result.pack!.exclusions.some(item => item.reason === 'unresolved-semantic-origin' && item.critical)).toBe(true);
    const projection = renderRecoveryContextProjection(restored, 8_000);
    expect(projection).toContain('unresolved semantic sources=');
    expect(projection).not.toContain('Never promote missing');
    const summary = renderCompressionArtifactSummary(restored);
    expect(summary).toContain('unresolved semantic source=');
    expect(summary).not.toContain('Never promote missing');
    cases.push({ kind: 'unresolved-origin-after-checkpoint-limit', pack: result.pack, projection, summary });
  });

  it('preserves scope on the actual predecessor next-action fallback with different message evidence', async () => {
    const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/autonomy-context-c02-predecessor.json'), 'utf8')) as {
      sourceCommit: string; artifact: CompressionArtifact;
    };
    const artifact = fixture.artifact;
    expect(artifact.inProgress[0].evidenceRefs).not.toEqual(artifact.semanticAtoms![0].evidenceRefs);
    expect(artifact.inProgress[0].semanticAtomId).toBeUndefined();
    const result = await preview(normalizeCompressionArtifact(JSON.parse(JSON.stringify(artifact))));
    expect(result.pack!.items.some(item => item.text === artifact.nextAction)).toBe(false);
    const projection = renderRecoveryContextProjection(artifact);
    expect(projection).toContain('applicability=unconfirmed-turn');
    expect(projection).not.toContain(`active:\n- ${artifact.nextAction}`);
    expect(projection).not.toContain(`currentState: ${artifact.nextAction}`);
    cases.push({ kind: 'actual-predecessor-fallback', sourceCommit: fixture.sourceCommit, pack: result.pack, projection });
  });

  it('reports wrong-type scalar origins in recovery as well as summary and Main', async () => {
    const artifact = build([atom({ text: 'Goal X', type: 'decision' })]);
    artifact.objective = 'Goal X';
    artifact.semanticOrigins = { objective: 'a1' };
    const result = await preview(artifact);
    expect(result.validation).toBe('invalidated');
    expect(renderRecoveryContextProjection(artifact)).toContain('unresolved semantic sources=a1');
    expect(renderCompressionArtifactSummary(artifact)).toContain('unresolved semantic source=a1');
    cases.push({ kind: 'wrong-type-scalar', pack: result.pack });
  });

  it('prioritizes current records over historical atoms in the real next-compaction input', () => {
    const artifact = build([
      ...Array.from({ length: 12 }, (_, i) => atom({ id: `retired-${i}`, status: 'superseded', text: `Retired ${i}.` })),
      atom({ id: 'current-goal', type: 'goal', text: 'Current goal.' }),
      atom({ id: 'current-next', type: 'next_action', text: 'Current next step.' }),
    ]);
    const message = buildPreviousCompactionLedgerMessage({ previousArtifact: artifact });
    if (message?.role !== 'user') throw new Error('Expected user ledger');
    const text = (message.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Current goal.');
    expect(text).toContain('Current next step.');
    expect(text.indexOf('Current goal.')).toBeLessThan(text.indexOf('Retired'));
    expect(text.length).toBeLessThanOrEqual(2_000);
    cases.push({ kind: 'next-compression-priority', text });
  });

  it('keeps semantic records whole under budget and reports critical omissions', () => {
    const long = atom({ type: 'constraint', text: 'Bounded critical constraint '.repeat(20) });
    const artifact = build([long, ...Array.from({ length: 8 }, (_, i) => atom({ id: `small-${i}` }))]);
    const projection = renderRecoveryContextProjection(artifact, 200);
    expect(projection.length).toBeLessThanOrEqual(800);
    expect(projection).toContain('omitted by budget');
    expect(projection.includes(long.text)).toBe(false);
    const pack = buildLongSessionContinuityContext({ ...INPUT, compression: { semanticAtoms: [long] }, budgetChars: 200 });
    expect(pack.items).toEqual([]);
    expect(pack.budget.criticalOmissions).toBe(1);
    cases.push({ kind: 'bounded-records', projection, pack });
  });

  it('retains the legacy input shape without inventing verification', async () => {
    const artifact = { objective: 'Legacy objective.', constraints: ['Legacy constraint.'],
      decisions: ['Legacy decision.'], nextAction: 'Legacy next.', evidenceRefs: ['session:legacy'] };
    const result = await preview(artifact);
    expect(result.validation).toBe('current');
    expect(result.pack!.items.map(item => item.text)).toEqual([
      'Legacy objective.', 'Legacy constraint.', 'Legacy decision.', 'Legacy next.',
    ]);
    expect(result.pack!.items.every(item => item.semantic === undefined && item.polarity === undefined)).toBe(true);
    expect(result.pack!.items.every(item => item.evidenceRefs[0] === 'session:legacy')).toBe(true);
    legacy.push({ kind: 'legacy-strings', pack: result.pack, rendered: result.rendered });
  });

  it('keeps legacy compression rendering byte-for-byte when semantic atoms are absent', () => {
    const artifact: CompressionArtifact = build();
    const summary = renderCompressionArtifactSummary(artifact);
    expect(summary).toBe([
      '## Goal', 'Complete task.', '', '## Constraints & Preferences', '- none', '', '## Progress',
      '### Done', '- none', '', '### In Progress', '- Inspect result.', '', '### Blocked', '- none',
      '', '## Key Decisions', '- none', '', '## Next Steps', '1. Inspect result.', '', '## Critical Context', '- none',
    ].join('\n'));
    legacy.push({ kind: 'legacy-summary', summary });
  });
});

afterAll(() => {
  const root = resolve(import.meta.dirname, '../..');
  const paths = [
    'shared/long-session-continuity.ts', 'shared/types/context-item.ts', 'shared/task-ledger-working-context.ts',
    'electron/services/chat-api.ts', 'electron/services/sessions-api.ts', 'shared/host-api/contract.ts',
    'openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts',
    'openclaw_runtime/src/agents/agent-hooks/compaction-addressability.ts',
    'tests/unit/autonomy-context-semantic-state.test.ts',
    'tests/unit/compression-artifact.test.ts', 'tests/unit/long-session-continuity-context.test.ts',
    'tests/unit/fixtures/autonomy-context-c02-predecessor.json',
  ];
  const identity = { schema: 'AutonomyContextSemanticStateEvidence/v1', driven_by: 'agent', hashScheme: 'sha256-utf8-lf',
    actor: 'codex/context-system-01a213b7', sourceFiles: paths.map(path => ({ path,
      sha256: hash(readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')) })),
  };
  for (const [file, observations] of [['semantic-state-mapping.json', mapping],
    ['state-preservation-cases.json', cases], ['legacy-read-parity.json', legacy]] as const) {
    writeFileSync(join(OUTPUT, file), JSON.stringify({ ...identity, observations }, null, 2) + '\n');
  }
});
