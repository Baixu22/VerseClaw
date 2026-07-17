import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildMemoryMergeDraft,
  checkMemoryEvidence,
  clearMemoryCards,
  getMemoryConflictDetail,
  getMemoryCards,
  getMemoryHealthReport,
  getMemoryUtilityReport,
  getRoleMemoryPolicy,
  listMemoryFeedback,
  listMemoryAuditEvents,
  listMemoryConflicts,
  listMemoryProposals,
  listMemoryRetentionCandidates,
  listMemoryVersions,
  previewMemoryProposal,
  proposeMemoryRetention,
  proposeMemoryCard,
  recordMemoryInjection,
  recordMemoryFeedback,
  reviewMemoryProposalBatch,
  reviewMemoryProposalRecord,
  setMemoryStorePath,
  simulateMemoryInjection,
} from '../../openclaw_runtime/src/memory/memory-store';
import { buildContextPack } from '../../openclaw_runtime/src/memory/context-pack';
import { extractMemoryProposalDrafts } from '../../openclaw_runtime/src/memory/memory-extractor';
import type { MemoryCard } from '../../openclaw_runtime/src/memory/types';

describe('role memory v2 governance', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-role-memory-v2-'));
    setMemoryStorePath(join(tempDir, 'role-memory.sqlite'));
    clearMemoryCards();
  });

  afterEach(() => {
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists accepted proposals before applying active cards', () => {
    const decision = proposeMemoryCard({
      type: 'role_experience',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Architects should check migration notes before schema edits.',
      confidence: 0.9,
      importance: 0.6,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(true);
    expect(decision.proposal?.status).toBe('applied');
    expect(listMemoryProposals()).toHaveLength(1);
    expect(getMemoryCards({ roleName: 'architect' })).toHaveLength(1);
    expect(listMemoryVersions({ cardId: decision.card!.id })).toHaveLength(1);
    expect(listMemoryAuditEvents({ cardId: decision.card!.id }).length).toBeGreaterThan(0);
  });

  it('previews proposals with gatekeeper output without mutating memory state', () => {
    const preview = previewMemoryProposal({
      type: 'constraint',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Architects must preview role memory governance before applying it.',
      confidence: 0.92,
      importance: 0.8,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(preview.wouldWrite).toBe(false);
    expect(preview.normalized.type).toBe('constraint');
    expect(preview.decision.accepted).toBe(true);
    expect(preview.riskLevel).toBeDefined();
    expect(preview.evidence.status).toBe('verified');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(0);
    expect(listMemoryProposals()).toHaveLength(0);
    expect(listMemoryConflicts()).toHaveLength(0);
    expect(listMemoryAuditEvents()).toHaveLength(0);
  });

  it('keeps sensitive proposals in review until approved', () => {
    const decision = proposeMemoryCard({
      type: 'role_experience',
      scope: 'role',
      roleTags: ['reviewer'],
      content: 'Reviewer notes may include sensitive deployment context.',
      confidence: 0.9,
      importance: 0.6,
      sensitivity: 'sensitive',
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe('needs_review');
    expect(decision.proposal?.status).toBe('needs_review');
    expect(getMemoryCards({ roleName: 'reviewer' })).toHaveLength(0);

    const approved = reviewMemoryProposalRecord(decision.proposal!.id, 'approve');
    expect(approved.accepted).toBe(true);
    expect(getMemoryCards({ roleName: 'reviewer' })).toHaveLength(1);
  });

  it('does not apply an already-applied proposal twice', () => {
    const decision = proposeMemoryCard({
      type: 'role_experience',
      scope: 'role',
      roleTags: ['implementer'],
      content: 'Implementers should preserve proposal audit chains.',
      confidence: 0.9,
      importance: 0.6,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(true);
    expect(getMemoryCards({ roleName: 'implementer' })).toHaveLength(1);

    const reapplied = reviewMemoryProposalRecord(decision.proposal!.id, 'approve');
    expect(reapplied.accepted).toBe(false);
    expect(reapplied.reason).toContain('already applied');
    expect(getMemoryCards({ roleName: 'implementer' })).toHaveLength(1);
  });

  it('records ownership and policy fields on accepted proposals', () => {
    const decision = proposeMemoryCard({
      type: 'constraint',
      scope: 'role',
      roleTags: ['architect'],
      applicableRoles: ['architect', 'reviewer'],
      content: 'Renderer changes must preserve the host API boundary.',
      confidence: 0.92,
      importance: 0.85,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(true);
    expect(decision.card).toMatchObject({
      ownerRole: 'architect',
      applicableRoles: ['architect', 'reviewer'],
      type: 'constraint',
    });
    expect(decision.proposal?.riskLevel).toBeDefined();
    expect(decision.proposal?.permissionDecision).toBe('allow');
  });

  it('rejects role-authored workspace constraints through the permission matrix', () => {
    const decision = proposeMemoryCard({
      type: 'constraint',
      scope: 'workspace',
      roleTags: ['implementer'],
      content: 'Implementer can override workspace memory without review.',
      confidence: 0.9,
      importance: 0.9,
      source: 'role',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe('reject');
    expect(decision.permissionDecision).toBe('reject');
    expect(decision.suggestedAction).toBe('reject');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(0);
  });

  it('records scored context-pack candidate explanations', () => {
    const now = new Date().toISOString();
    const cards: MemoryCard[] = [
      {
        id: 'mem-user',
        type: 'role_experience',
        scope: 'user',
        roleTags: ['architect'],
        phaseTags: ['plan'],
        content: 'Always protect renderer-main API boundaries.',
        evidence: [],
        evidenceRefs: [],
        confidence: 0.95,
        importance: 0.9,
        lastAccessedAt: now,
        createdAt: now,
        updatedAt: now,
        accessCount: 3,
        version: 1,
        status: 'active',
        sensitivity: 'normal',
      },
      {
        id: 'mem-secret',
        type: 'role_experience',
        scope: 'role',
        roleTags: ['architect'],
        content: 'token=secret',
        evidence: [],
        confidence: 0.9,
        importance: 0.7,
        lastAccessedAt: now,
        createdAt: now,
        accessCount: 0,
        version: 1,
        status: 'active',
        sensitivity: 'secret',
      },
    ];

    const pack = buildContextPack({ memories: cards, roleName: 'architect', phase: 'plan', taskState: 'renderer main boundary work' });
    expect(pack.policyVersion).toBe('role-memory-context-v3');
    expect(pack.candidateExplanations?.find((entry) => entry.cardId === 'mem-user')?.selected).toBe(true);
    expect(pack.candidateExplanations?.find((entry) => entry.cardId === 'mem-user')?.injectionClass).toBeDefined();
    expect(pack.candidateExplanations?.find((entry) => entry.cardId === 'mem-secret')?.truncatedReason).toBe('sensitivity');
  });

  it('extracts explicit remember text as proposal drafts without applying memory', () => {
    const drafts = extractMemoryProposalDrafts({
      text: 'remember architects should check injection explain logs after orchestration',
      roleName: 'architect',
      scopeKey: 'workspace-a',
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].draftSource).toBe('explicit_remember');
    expect(drafts[0].source).toBe('user');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(0);
  });

  it('keeps automatic Role Memory candidates as proposals without applying cards', () => {
    const decision = proposeMemoryCard({
      type: 'procedure',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Architect should capture failed migration assumptions only after review.',
      confidence: 0.88,
      importance: 0.62,
      source: 'trace',
      evidenceRefs: [{ type: 'trace', ref: 'trace-auto-1' }],
    });

    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe('needs_review');
    expect(decision.reason).toContain('proposal-only');
    expect(decision.proposal?.status).toBe('needs_review');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(0);
    expect(listMemoryProposals()).toHaveLength(1);
  });

  it('does not write Project Rules from automatic Role Memory proposals', () => {
    const guardedFiles = [
      join(tempDir, 'AGENTS.md'),
      join(tempDir, 'harness', 'specs', 'tasks', 'auto-memory.md'),
      join(tempDir, '.clawx', 'rules', 'auto-memory.md'),
    ];
    for (const file of guardedFiles) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `unchanged:${file}`);
    }
    const before = new Map(guardedFiles.map((file) => [file, readFileSync(file, 'utf8')]));

    const decision = proposeMemoryCard({
      type: 'constraint',
      scope: 'project',
      roleTags: ['architect'],
      content: 'Project Rules should not be rewritten by automatic role memory.',
      confidence: 0.92,
      importance: 0.8,
      source: 'role',
      evidenceRefs: guardedFiles.map((file) => ({ type: 'file' as const, ref: file })),
    });

    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe('needs_review');
    expect(decision.proposal?.status).toBe('needs_review');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(0);
    for (const file of guardedFiles) {
      expect(readFileSync(file, 'utf8')).toBe(before.get(file));
    }
  });

  it('exposes policy and retention candidates without mutating cards', () => {
    const decision = proposeMemoryCard({
      type: 'episode',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Old migration detail that is rarely used.',
      confidence: 0.9,
      importance: 0.3,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(true);
    const policy = getRoleMemoryPolicy();
    expect(policy.version).toBe('role-memory-governance-v4');
    expect(policy.contextPolicyVersion).toBe('role-memory-context-v3');
    const retention = listMemoryRetentionCandidates({ includeKeep: true });
    expect(retention).toHaveLength(1);
    expect(retention[0].labels).toContain('Rarely used');
  });

  it('turns retention suggestions into review proposals without mutating cards', () => {
    const decision = proposeMemoryCard({
      type: 'episode',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Rarely used role episode for cleanup.',
      confidence: 0.9,
      importance: 0.2,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(decision.accepted).toBe(true);
    const before = getMemoryCards({ status: 'all' })[0];
    const run = proposeMemoryRetention({ cardId: before.id, action: 'cold' });

    expect(run.proposals).toHaveLength(1);
    expect(run.proposals[0].status).toBe('needs_review');
    expect(run.proposals[0].retentionReason).toBeTruthy();
    expect(getMemoryCards({ status: 'all' })[0].status).toBe('active');
  });

  it('batch reviews proposals independently and continues after failures', () => {
    const sensitive = proposeMemoryCard({
      type: 'procedure',
      scope: 'role',
      roleTags: ['reviewer'],
      content: 'Reviewer should treat deployment notes as sensitive context.',
      confidence: 0.9,
      importance: 0.55,
      sensitivity: 'sensitive',
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    const batch = reviewMemoryProposalBatch({
      ids: [sensitive.proposal!.id, 'missing-proposal'],
      action: 'approve',
    });

    expect(batch.results).toHaveLength(2);
    expect(batch.results[0].ok).toBe(true);
    expect(batch.results[1].ok).toBe(false);
    expect(getMemoryCards({ roleName: 'reviewer' })).toHaveLength(1);
  });

  it('explains conflicts and builds merge drafts without applying them', () => {
    const first = proposeMemoryCard({
      type: 'fact',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Role memory uses SQLite for governed cards.',
      confidence: 0.9,
      importance: 0.6,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });
    const duplicate = proposeMemoryCard({
      type: 'fact',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Role memory uses SQLite for governed cards.',
      confidence: 0.9,
      importance: 0.6,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });

    expect(duplicate.action).toBe('needs_review');
    const conflict = listMemoryConflicts({ status: 'open' })[0];
    const detail = getMemoryConflictDetail(conflict.id);
    expect(detail.suggestedAction).toBe('merge');
    expect(detail.cards[0].id).toBe(first.card!.id);

    const draft = buildMemoryMergeDraft({ cardIds: [first.card!.id], proposalIds: [duplicate.proposal!.id] });
    expect(draft.draft.content).toContain('Role memory uses SQLite');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(1);
  });

  it('checks evidence health without writing native memory and simulates injection with the real selector', () => {
    const decision = proposeMemoryCard({
      type: 'constraint',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Role memory must not write native MEMORY.md.',
      confidence: 0.95,
      importance: 0.9,
      source: 'user',
      evidenceRefs: [{ type: 'memory_md', ref: 'MEMORY.md', excerpt: 'Role memory must not write native MEMORY.md.' }],
    });

    const evidence = checkMemoryEvidence({ id: decision.card!.id, kind: 'card' });
    expect(evidence.status).toBe('verified');

    const simulation = simulateMemoryInjection({
      roleName: 'architect',
      task: 'Check role memory native MEMORY boundary',
      dualGate: { useEnabled: true },
    });
    const simulated = simulation.pack.candidateExplanations?.find((entry) => entry.cardId === decision.card!.id);
    const realPack = buildContextPack({
      memories: getMemoryCards({ roleName: 'architect', status: 'all' }),
      roleName: 'architect',
      taskState: 'Check role memory native MEMORY boundary',
    });
    const real = realPack.candidateExplanations?.find((entry) => entry.cardId === decision.card!.id);
    expect(simulated?.selected).toBe(real?.selected);
    expect(simulated?.injectionClass).toBe('must');

    const health = getMemoryHealthReport();
    expect(health.ok).toBe(true);
  });

  it('records real feedback and reports utility without inventing task success delta', () => {
    const decision = proposeMemoryCard({
      type: 'procedure',
      scope: 'role',
      roleTags: ['architect'],
      content: 'Architect should inspect role memory quality before expanding automatic extraction.',
      confidence: 0.92,
      importance: 0.7,
      source: 'user',
      evidenceRefs: [{ type: 'manual', ref: 'test' }],
    });
    const cards = getMemoryCards({ roleName: 'architect', status: 'all' });
    const pack = buildContextPack({
      memories: cards,
      roleName: 'architect',
      taskState: 'inspect role memory quality',
    });
    const injection = recordMemoryInjection({
      roleName: 'architect',
      task: 'inspect role memory quality',
      cards: decision.card ? [decision.card] : [],
      pack,
    });
    const feedback = recordMemoryFeedback({
      injectionId: injection.id,
      cardId: decision.card!.id,
      roleName: 'architect',
      outcome: 'helpful',
      taskSuccess: 'unknown',
    });

    expect(feedback.outcome).toBe('helpful');
    expect(listMemoryFeedback({ roleName: 'architect' })).toHaveLength(1);

    const report = getMemoryUtilityReport({ roleName: 'architect' });
    expect(report.dataQuality).toBe('partial');
    expect(report.sample.feedback).toBe(1);
    expect(report.aggregate.helpfulnessRate).toBe(1);
    expect(report.aggregate.taskSuccessDelta).toBeNull();
    expect(report.missingEvidence).toContain('No memory-on/off evaluation pairs are available, so task success delta is not computed.');
    expect(report.cards.find((card) => card.cardId === decision.card!.id)?.utilityScore).not.toBeNull();
  });
});
