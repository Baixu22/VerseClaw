import type {
  KnowledgeSourceRef,
  KnowledgeSourceSetAnswerSource,
} from '../../shared/host-api/contract';
import {
  digestSourceSetContent,
  lexicalOverlapScore,
  retrieveSourceSet,
  type SourceSetCandidate,
  type SourceSetClaimSeed,
  type SourceSetRef,
  type SourceSetSensitivity,
  type SourceSetTrust,
} from '../../openclaw_runtime/src/context-engine/source-set';
import type { RuntimeEmbeddingProvider } from '../../openclaw_runtime/src/runtime-core/memory-embedding-provider';
import { isOwnerReadSnapshotV1, evaluateOwnerReadSnapshot, matchOwnerReadPin,
  type OwnerReadRejectionCode } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { isMemorySourceRef } from '../../shared/knowledge/memory';
import { getExplicitKnowledgeOwner, isExperienceSourceRef } from '../../shared/knowledge/experience';

const UNKNOWN_FRESHNESS = '1970-01-01T00:00:00.000Z';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((entry) => text(entry) ? [text(entry)!] : []) : [];
}

function claims(value: unknown): SourceSetClaimSeed[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!record(entry)) return [];
    const claimId = text(entry.claimId) ?? text(entry.id);
    const statement = text(entry.statement) ?? text(entry.text);
    const stance = text(entry.stance) ?? statement;
    return claimId && statement && stance ? [{ claimId, statement, stance }] : [];
  });
}

function sourceSensitivity(value: unknown): SourceSetSensitivity {
  if (value === undefined) return 'workspace';
  const tiers: Record<string, SourceSetSensitivity> = {
    public: 'public', internal: 'workspace', workspace: 'workspace',
    personal: 'sensitive', private: 'sensitive', sensitive: 'sensitive',
    'secret-adjacent': 'secret-adjacent', secret_adjacent: 'secret-adjacent', secret: 'secret',
  };
  // An explicit unknown owner policy must never become workspace-readable.
  const key = text(value) ?? '';
  return Object.hasOwn(tiers, key) ? tiers[key]! : 'secret';
}

function sourceTrust(value: unknown): SourceSetTrust {
  if (value === undefined) return 'advisory';
  return value === 'untrusted' || value === 'advisory' || value === 'confirmed' || value === 'high-trust'
    ? value : 'untrusted';
}

type MaterializedSource = {
  source: KnowledgeSourceSetAnswerSource;
  candidate: SourceSetCandidate;
};

/** Read at most 800 lines / 96k characters, retaining the most relevant 80-line window.
 * Each continuation must have the same owner revision and policy; mixed snapshots
 * cannot become evidence. Missing version metadata leaves the first read partial. */
export async function readBoundedKnowledgePage(input: {
  ref: KnowledgeSourceRef;
  question: string;
  workspaceId?: string;
  read: (range: { fromLine?: number; lineCount: number }) => Promise<unknown>;
}): Promise<unknown> {
  if (getExplicitKnowledgeOwner(input.ref) && !isMemorySourceRef(input.ref.sourceRef) && !isExperienceSourceRef(input.ref.sourceRef)) {
    return { success: false, readDenial: 'denied' };
  }
  const first = await input.read({ lineCount: 80 });
  if (!record(first) || typeof first.content !== 'string') return first;
  if (first.content.length > 96_000) return { success: false, readDenial: 'denied', status: 'denied', statusReason: 'source read exceeds the character budget' };
  if (input.ref.contentDigest || input.ref.sourceRef?.locator) return first;
  const admitted = await retrieveSelectedSourceSetEvidence({
    question: input.question, sourceRefs: [input.ref], workspaceId: input.workspaceId,
    readPage: async () => first,
  });
  if (!admitted.sources.length || !admitted.sources[0].readRange?.truncated) return first;
  const owner = (page: Record<string, unknown>) => {
    if (isOwnerReadSnapshotV1(page.ownerSnapshot)) return JSON.stringify([
      page.ownerSnapshot.source.namespaceId, page.ownerSnapshot.source.subjectId,
      page.ownerSnapshot.source.revision, page.ownerSnapshot.source.sourceDigest, page.ownerSnapshot.source.policyEpoch,
      page.ownerSnapshot.context.sessionId, page.ownerSnapshot.context.workspaceId, page.ownerSnapshot.context.workspaceRootDigest,
    ]);
    const metadata = record(page.metadata) ? page.metadata : {};
    return JSON.stringify(['path', 'corpus', 'revision', 'updatedAt', 'status', 'privacyTier', 'sensitivity', 'acl', 'scope', 'workspaceId', 'agentId', 'trust']
      .map(key => page[key] ?? metadata[key]));
  };
  const binding = owner(first);
  const metadata = record(first.metadata) ? first.metadata : {};
  if (first.revision === undefined && metadata.revision === undefined && first.updatedAt === undefined && metadata.updatedAt === undefined) return first;
  let best = first, bestScore = lexicalOverlapScore(input.question, first.content), chars = first.content.length;
  for (let fromLine = 81; fromLine <= Math.min(800, Number(first.totalLines) || 80); fromLine += 80) {
    if (chars >= 96_000) break;
    const page = await input.read({ fromLine, lineCount: 80 });
    if (!record(page) || typeof page.content !== 'string' || page.fromLine !== fromLine || owner(page) !== binding || page.totalLines !== first.totalLines) {
      return { ...first, status: 'denied', statusReason: 'source changed during bounded continuation' };
    }
    chars += page.content.length;
    if (chars > 96_000) break;
    const score = lexicalOverlapScore(input.question, page.content);
    if (score > bestScore) { best = page; bestScore = score; }
  }
  return best;
}

function materializeSource(ref: KnowledgeSourceRef, page: unknown): MaterializedSource | null {
  if (!record(page) || page.success === false) return null;
  const snapshot = isOwnerReadSnapshotV1(page.ownerSnapshot) ? page.ownerSnapshot : undefined;
  if (page.corpus !== undefined && page.corpus !== 'wiki'
    && !(page.corpus === 'memory' && snapshot && isMemorySourceRef(snapshot.source))
    && !(page.corpus === 'all' && snapshot && isExperienceSourceRef(snapshot.source))) return null;
  const owner = snapshot?.source.domain === 'native-memory' ? 'native-memory'
    : snapshot?.source.domain === 'role-memory' ? 'memory-slot'
    : snapshot?.source.domain === 'experience' ? 'sekb' : 'memory-wiki';
  const contentValue = ['content', 'body', 'text', 'snippet', 'bodyPreview'].map((key) => page[key])
    .find((value) => value !== undefined);
  const content = typeof contentValue === 'string' && contentValue.trim().length > 0 ? contentValue : undefined;
  if (!content) return null;
  const metadata = record(page.metadata) ? page.metadata : {};
  const ownerValue = (key: string): unknown => {
    if (snapshot) {
      if (key === 'revision') return snapshot.source.revision;
      if (key === 'contentDigest') return snapshot.contentDigest;
      if (key === 'scope') return snapshot.policy.scope;
      if (key === 'acl') return snapshot.policy.acl;
      if (key === 'retention') return snapshot.policy.retention;
      if (key === 'updatedAt') return snapshot.policy.updatedAt;
      if (key === 'status' || key === 'trust' || key === 'sensitivity') return snapshot.policy[key];
    }
    return page[key] !== undefined ? page[key] : metadata[key];
  };
  const lookup = ref.path || ref.id;
  const path = snapshot?.source.subjectId ?? text(page.path) ?? text(page.pagePath) ?? lookup;
  const title = text(page.title) ?? text(page.name) ?? ref.label ?? lookup;
  const digest = digestSourceSetContent(content);
  const ownerRevision = ownerValue('revision');
  const revision = typeof ownerRevision === 'number' && Number.isFinite(ownerRevision)
    ? String(ownerRevision) : text(ownerRevision) ?? digest;
  const ownerDigest = ownerValue('contentDigest');
  const contentDigest = ownerDigest === undefined ? digest : text(ownerDigest) ?? 'invalid-owner-digest';
  const timestamp = text(ownerValue('updatedAt')) ?? text(ownerValue('indexedAt'));
  const updatedAt = timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined;
  const ownerAcl = ownerValue('acl');
  const validAcl = record(ownerAcl) && Array.isArray(ownerAcl.read)
    && ownerAcl.read.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
  const acl = ownerAcl === undefined ? { read: ['operator'] } : { read: validAcl ? strings(ownerAcl.read) : ['invalid-owner-acl'] };
  const ownerScope = ownerValue('scope');
  const scopeRecord = record(ownerScope) ? ownerScope : {};
  const workspaceId = text(scopeRecord.workspaceId) ?? text(ownerValue('workspaceId'));
  const agentId = text(scopeRecord.agentId) ?? text(ownerValue('agentId'));
  const scope: SourceSetRef['scope'] = workspaceId || agentId
    ? { ...(workspaceId ? { workspaceId } : {}), ...(agentId ? { agentId } : {}),
      ...(text(scopeRecord.sessionKey) ? { sessionKey: text(scopeRecord.sessionKey) } : {}),
      ...(text(scopeRecord.taskId) ? { taskId: text(scopeRecord.taskId) } : {}) }
    : snapshot?.policy.scope;
  const invalidScope = (ownerScope !== undefined && !record(ownerScope))
    || [scopeRecord.workspaceId, scopeRecord.agentId, ownerValue('workspaceId'), ownerValue('agentId')]
      .some((value) => value !== undefined && !text(value));
  const invalidPolicy = page.ownerSnapshot !== undefined && (!snapshot || snapshot.source.authorityId !== owner || snapshot.content !== content
    || evaluateOwnerReadSnapshot(snapshot, snapshot.context)) ? 'invalid owner snapshot'
    : ownerAcl !== undefined && !validAcl
    ? 'invalid owner ACL' : invalidScope
      ? 'invalid owner scope' : ownerRevision !== undefined
        && !(typeof ownerRevision === 'number' && Number.isFinite(ownerRevision)) && !text(ownerRevision)
        ? 'invalid owner revision' : undefined;
  const ownerStatus = ownerValue('status');
  const suppliedStatus = ownerStatus === undefined ? 'active' : text(ownerStatus);
  const validStatus = suppliedStatus === 'active' || suppliedStatus === 'archived' || suppliedStatus === 'revoked'
    || suppliedStatus === 'deleted' || suppliedStatus === 'denied' || suppliedStatus === 'stale';
  const status = invalidPolicy || !validStatus ? 'denied' : suppliedStatus;
  const statusReason = invalidPolicy ?? (!validStatus ? 'unknown owner status' : text(ownerValue('statusReason')));
  const fromLine = typeof page.fromLine === 'number' && Number.isInteger(page.fromLine) && page.fromLine > 0 ? page.fromLine : 1;
  const toLine = fromLine + content.split(/\r?\n/).length - 1;
  const totalLines = typeof page.totalLines === 'number' && Number.isInteger(page.totalLines) && page.totalLines >= toLine
    ? page.totalLines : undefined;
  const invalidRange = (page.fromLine !== undefined && !(typeof page.fromLine === 'number' && Number.isInteger(page.fromLine) && page.fromLine > 0))
    || (page.totalLines !== undefined && totalLines === undefined)
    || (page.truncated !== undefined && typeof page.truncated !== 'boolean');
  const truncated = page.truncated === true || fromLine > 1 || (totalLines !== undefined && totalLines > toLine);
  const candidate: SourceSetCandidate = {
    ref: {
      refId: snapshot ? `${owner}:${snapshot.source.namespaceId}:${path}:${snapshot.source.locator!.startByte}-${snapshot.source.locator!.endByteExclusive}` : `memory-wiki:${path}`,
      owner, subjectKind: owner === 'native-memory' ? 'memory-file' : owner === 'memory-slot' ? 'memory-card' : owner === 'sekb' ? 'experience-principle' : 'wiki-page', subjectId: path,
      revision, contentDigest,
      trust: sourceTrust(ownerValue('trust')),
      sensitivity: sourceSensitivity(ownerValue('sensitivity') === undefined ? ownerValue('privacyTier') : ownerValue('sensitivity')),
      acl, ...(scope ? { scope } : {}),
      ...(snapshot ? { sourceRef: snapshot.source, ownerSnapshot: snapshot, retention: snapshot.policy.retention } : {}),
      provenance: { sourceRefs: strings(ownerValue('sourceRefs')).length > 0 ? strings(ownerValue('sourceRefs')) : [ref.id], evidenceRefs: strings(ownerValue('evidenceRefs')) },
    },
    content, status: invalidRange ? 'denied' : status as SourceSetCandidate['status'],
    ...(invalidRange || statusReason ? { statusReason: invalidRange ? 'invalid owner read range' : statusReason } : {}),
    indexedAt: updatedAt ?? UNKNOWN_FRESHNESS,
    claims: claims(ownerValue('claims')),
    conflictKeys: strings(ownerValue('conflictKeys')),
  };
  return {
    candidate,
    source: {
      id: ref.id, lookup, path, title,
      ...(ownerValue('hasConflicts') === true ? { conflictGroupId: 'known-conflicts' } : {}),
      excerpt: content.replace(/\s+/g, ' ').trim().slice(0, 240),
      ...(updatedAt ? { updatedAt } : {}),
      readRange: snapshot ? { fromLine: snapshot.source.locator!.startLine, toLine: snapshot.source.locator!.endLine,
        totalLines: snapshot.totalLines, truncated: snapshot.truncated }
        : { fromLine, toLine, ...(totalLines === undefined ? {} : { totalLines }), truncated },
    },
  };
}

/** Selection is an exact retrieval intent, never an override of owner admission. */
export async function retrieveSelectedSourceSetEvidence(input: {
  question: string;
  sourceRefs: KnowledgeSourceRef[];
  readPage: (ref: KnowledgeSourceRef) => Promise<unknown>;
  workspaceId?: string;
  embeddingProvider?: RuntimeEmbeddingProvider;
}) {
  const materialized = await Promise.all(input.sourceRefs.map(async (ref) => {
    try { return materializeSource(ref, await input.readPage(ref)); } catch { return null; }
  }));
  const byRefId = new Map<string, MaterializedSource>();
  for (const entry of materialized) {
    if (!entry) continue;
    const previous = byRefId.get(entry.candidate.ref.refId);
    if (!previous) byRefId.set(entry.candidate.ref.refId, entry);
    else if (previous.candidate.status !== entry.candidate.status
      || previous.candidate.ref.revision !== entry.candidate.ref.revision
      || previous.candidate.ref.contentDigest !== entry.candidate.ref.contentDigest
      || previous.candidate.ref.sensitivity !== entry.candidate.ref.sensitivity
      || JSON.stringify(previous.candidate.ref.acl) !== JSON.stringify(entry.candidate.ref.acl)
      || JSON.stringify(previous.candidate.ref.scope) !== JSON.stringify(entry.candidate.ref.scope)) {
      previous.candidate.status = 'denied';
      previous.candidate.statusReason = 'inconsistent owner reads for the same canonical source';
    }
  }
  const sourceSet = await retrieveSourceSet({
    sources: [...byRefId.values()].map((entry) => entry.candidate),
    preserveOrder: true,
    query: {
      text: input.question, aclSubjects: ['operator'],
      ...([...byRefId.values()].some(entry => entry.candidate.ref.ownerSnapshot) ? { taskContext: (() => {
        const context = [...byRefId.values()].find(entry => entry.candidate.ref.ownerSnapshot)!.candidate.ref.ownerSnapshot!.context;
        return { workspaceId: context.workspaceId, agentId: context.agentId, sessionKey: context.sessionKey };
      })() } : input.workspaceId ? { taskContext: { workspaceId: input.workspaceId } } : {}),
      pinnedRefs: input.sourceRefs.map((ref, index) => ({
        owner: materialized[index]?.candidate.ref.owner ?? getExplicitKnowledgeOwner(ref) ?? 'memory-wiki',
        subjectId: materialized[index]?.candidate.ref.subjectId ?? ref.sourceRef?.subjectId ?? ref.path ?? ref.id,
        ...(ref.revision === undefined ? {} : { revision: ref.revision }),
        ...(ref.contentDigest === undefined ? {} : { contentDigest: ref.contentDigest }),
        ...(ref.sourceRef ? { sourceRef: ref.sourceRef } : {}),
      })),
      limit: Math.max(1, byRefId.size),
    },
    embeddingProvider: input.embeddingProvider,
    verifyOwnerRead: async (candidate, stage, providerRef) => {
      const original = materialized.find(entry => entry?.candidate.ref.refId === candidate.ref.refId);
      if (!original) return 'not_found';
      const selected = input.sourceRefs[materialized.indexOf(original)];
      const page = await input.readPage({ ...selected, ...(candidate.ref.sourceRef ? { sourceRef: candidate.ref.sourceRef } : {}) });
      if (record(page) && page.status === 'denied') return text(page.reason) as OwnerReadRejectionCode ?? 'denied';
      const current = materializeSource(selected, page);
      if (!current) return 'not_found';
      if (candidate.ref.ownerSnapshot) {
        const fresh = current.candidate.ref.ownerSnapshot;
        if (!fresh) return 'denied';
        const reason = matchOwnerReadPin(fresh, candidate.ref.sourceRef!)
          ?? evaluateOwnerReadSnapshot(fresh, fresh.context, { stage, providerRef });
        if (reason) return reason;
        const previous = candidate.ref.ownerSnapshot.context;
        if (previous.sessionId !== fresh.context.sessionId || previous.sessionKey !== fresh.context.sessionKey
          || previous.workspaceId !== fresh.context.workspaceId || previous.workspaceRootDigest !== fresh.context.workspaceRootDigest) return 'invalid_context';
        candidate.ref.ownerSnapshot = fresh;
      }
      if (current.candidate.ref.revision !== candidate.ref.revision) return 'revision_mismatch';
      if (current.candidate.ref.contentDigest !== candidate.ref.contentDigest || current.candidate.content !== candidate.content) return 'digest_mismatch';
      if (current.candidate.status !== 'active') return current.candidate.status;
      if (JSON.stringify([current.candidate.ref.acl, current.candidate.ref.scope, current.candidate.ref.retention, current.candidate.ref.sensitivity])
        !== JSON.stringify([candidate.ref.acl, candidate.ref.scope, candidate.ref.retention, candidate.ref.sensitivity])) return 'policy_changed';
      return undefined;
    },
  });
  const sources: KnowledgeSourceSetAnswerSource[] = sourceSet.retrieved.map((entry) => {
    const original = byRefId.get(entry.ref.refId)!.source;
    return {
      ...original,
      citation: {
        refId: entry.ref.refId, owner: entry.ref.owner, subjectId: entry.ref.subjectId,
        revision: entry.ref.revision, contentDigest: entry.ref.contentDigest,
        sourceRefs: entry.ref.provenance?.sourceRefs ?? [],
        ...(entry.ref.sourceRef ? { sourceRef: entry.ref.sourceRef } : {}),
      },
    };
  });
  const unknowns = [...new Set([
    'Grounding is page/snippet level.',
    ...(sources.length > 0 ? ['This response contains source excerpts; synthesized answer correctness and unstructured contradictions have not been evaluated.'] : []),
    ...sourceSet.unknowns.map((entry) => entry.text),
    ...sourceSet.rejections.map((entry) => entry.visibleReason),
    ...sourceSet.conflictSet.map((entry) => entry.description),
    ...sources.flatMap((source) => [
      ...(!source.updatedAt ? [`Source "${source.lookup}" has no known freshness timestamp.`] : []),
      ...(source.readRange?.truncated ? [`Source "${source.lookup}" is truncated to lines ${source.readRange.fromLine}-${source.readRange.toLine}${source.readRange.totalLines === undefined ? '' : ` of ${source.readRange.totalLines}`}; unread lines cannot ground this response.`] : []),
    ]),
  ])];
  return {
    sourceSet, sources, unknowns,
    modelSources: sourceSet.retrieved.map((entry, index) => ({ ...sources[index], content: entry.content })),
    // This handler lists evidence. Actual QA/citation verification is a separate delivery.
    groundingStatus: sources.length === 0 ? 'missing_sources' as const : 'partial' as const,
  };
}
