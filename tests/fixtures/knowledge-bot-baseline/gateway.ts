import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { createOwnerReadSnapshot, deriveReadAdmissionContext, digestOwnerReadContent } from '../../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { createRetrievalPlan } from '../../../openclaw_runtime/src/knowledge/retrieval/plan';
import { PROJECT_RAG_DEFAULTS } from '../../../shared/knowledge/operations';
import corpus from './corpus.json';

export type InputCase = typeof corpus.cases[number];
type Source = typeof corpus.sources[number];
type Identity = { workspaceId: string; agentSessionKey: string; sessionId: string };
type Reference = { id: string; lookup: string; sourceRef: ReturnType<typeof createOwnerReadSnapshot>['source']; contentDigest: string };
const namespaceId = 'kb-baseline-wiki';
const sessionId = '10000000-0000-4000-8000-000000000001';

export function materialize(page: Source) {
  return [page.body, ...Array.from({ length: page.trailingLines ?? 0 }, (_, i) => 'Background note ' + i), ...(page.tail ? [page.tail] : [])].join('\n');
}

function pickPage(id: string) {
  const page = corpus.sources.find(item => item.id === id);
  if (!page) throw Error('Unknown fixture source: ' + id);
  return page;
}

function readPage(id: string, identity: Identity, from: number, count: number, pin?: Reference['sourceRef']) {
  const page = pickPage(id);
  const raw = materialize(page);
  const lines = raw.split('\n');
  const start = pin?.locator ? Buffer.from(raw).subarray(0, pin.locator.startByte).toString().length :
    lines.slice(0, from - 1).reduce((n, line) => n + line.length + 1, 0);
  const end = pin?.locator ? Buffer.from(raw).subarray(0, pin.locator.endByteExclusive).toString().length :
    start + lines.slice(from - 1, from - 1 + count).join('\n').length;
  const context = deriveReadAdmissionContext({ principalId: 'operator', sessionId: identity.sessionId, sessionKey: identity.agentSessionKey,
    workspaceId: identity.workspaceId, ownerNamespaces: [namespaceId], egressProviderRefs: [],
    policyDigest: digestOwnerReadContent('baseline-policy'), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const snapshot = createOwnerReadSnapshot({ raw, startChar: start, endChar: end, title: page.title, context,
    source: { domain: 'wiki', authorityId: 'memory-wiki', namespaceId, subjectId: id, revision: page.rev },
    policy: { status: page.status === 'revoked' ? 'revoked' : 'active', trust: 'confirmed', sensitivity: 'workspace', acl: { read: ['operator'] },
      scope: { workspaceId: identity.workspaceId }, retention: { policy: 'source-coupled' }, updatedAt: '2026-11-20T00:00:00Z' } });
  const locator = snapshot.source.locator!;
  return { corpus: 'wiki', path: id, title: page.title, content: snapshot.content, revision: Number(page.rev), status: snapshot.policy.status,
    ownerSnapshot: snapshot, fromLine: locator.startLine, totalLines: lines.length, truncated: start !== 0 || end !== raw.length,
    ...(page.claim ? { claims: [page.claim] } : {}) };
}

// The fixture model sees only the byte ranges in the Host's transport references.
function modelTurn(label: string, message: string, refs: Reference[], runId: string) {
  const documents = refs.map(ref => {
    const raw = Buffer.from(materialize(pickPage(ref.lookup)));
    const loc = ref.sourceRef.locator!;
    return { ref, text: raw.subarray(loc.startByte, loc.endByteExclusive).toString('utf8') };
  });
  const prompt = JSON.parse(message.split('\n').at(-1)!);
  let output;
  if (label === 'Knowledge claim support') {
    output = { answerability: 'answerable', claims: prompt.claims.map((claim: { index: number; text: string; sourceIds: string[] }) => ({
      index: claim.index, status: documents.some(doc => claim.sourceIds.includes(doc.ref.id) && doc.text.split('\n').includes(claim.text)) ? 'supported' : 'unsupported',
      reason: 'Compared literal field line with cited fixture bytes.',
    })) };
  } else {
    const question: string = prompt.currentQuestion.toLowerCase();
    const claims = documents.flatMap(doc => doc.text.split('\n').filter(line => {
      const key = line.match(/^([^:：]+)[:：]/u)?.[1];
      return key && question.includes(key.trim().toLowerCase());
    }).map(line => ({ kind: 'source', text: line, citations: [{ sourceId: doc.ref.id, quote: line }] })));
    output = { claims, unknowns: claims.length ? [] : ['No requested field was found in the supplied evidence.'] };
  }
  const bytes = documents.reduce((n, doc) => n + Buffer.byteLength(doc.text), 0);
  const retainedEvidence = { schema: 'RetainedEvidenceManifest/v1', turnId: runId, estimateMethod: 'utf8-bytes-div4',
    retainedChars: documents.reduce((n, doc) => n + doc.text.length, 0), retainedUtf8Bytes: bytes, estimatedTokens: Math.ceil(bytes / 4),
    units: documents.map(({ ref, text }, ordinal) => ({ schema: 'KnowledgeCandidatePacking/v2', unitId: 'unit-' + ordinal, candidateId: ref.id,
      ordinal, projectionDigest: digestOwnerReadContent(text), retainedChars: text.length, retainedUtf8Bytes: Buffer.byteLength(text),
      estimatedTokens: Math.ceil(Buffer.byteLength(text) / 4), citations: [{ refId: ref.id, intentId: ref.id, sourceRef: ref.sourceRef,
        sourceDigest: ref.sourceRef.sourceDigest, chunkDigest: digestOwnerReadContent(text), retainedBodyChars: text.length, retainedBodyUtf8Bytes: Buffer.byteLength(text) }] })) };
  return { status: 'completed', text: JSON.stringify(output), retainedEvidence };
}

export class FixtureGateway extends EventEmitter {
  readonly reads: string[] = [];
  readonly modelInputs: Array<{ label: string; sources: string[] }> = [];
  readonly methods: string[] = [];
  readonly unexpected: string[] = [];
  private runs = new Map<string, ReturnType<typeof modelTurn>>();
  constructor(private readonly task: InputCase) { super(); }

  async rpc(method: string, p: Record<string, unknown> = {}) {
    this.methods.push(method);
    const identity = p.readIdentity as Identity;
    switch (method) {
      case 'sessions.describe': return { session: { sessionId } };
      case 'wiki.operations.config': return PROJECT_RAG_DEFAULTS;
      case 'wiki.status': return { vaultExists: true };
      case 'wiki.retrieve': {
        const results = this.task.search.map((id, index) => {
          const page = readPage(id, identity, 1, 80);
          return { lookup: id, pagePath: id, title: page.title, sourceRef: page.ownerSnapshot.source, rank: index + 1, score: 1 / (61 + index) };
        });
        return { schema: 'RetrievalResult/v2', plan: createRetrievalPlan({ query: String(p.query), namespaceIds: [namespaceId] }),
          status: 'complete', effectiveProfile: 'local', filters: [], lanes: [], fallbackReasons: [], results };
      }
      case 'wiki.get': {
        const id = String(p.lookup);
        this.reads.push(id);
        return readPage(id, identity, Number(p.fromLine ?? 1), Number(p.lineCount ?? 80), p.sourceRef as Reference['sourceRef'] | undefined);
      }
      case 'agent': {
        const refs = (p.knowledgeReferences ?? []) as Reference[];
        const label = String(p.label);
        if (!p.modelRun || p.deliver !== false || !['Knowledge Librarian', 'Knowledge claim support'].includes(label)) throw Error('Unexpected model intent');
        this.modelInputs.push({ label, sources: refs.map(ref => ref.lookup) });
        const runId = this.task.id + '-' + this.modelInputs.length;
        this.runs.set(runId, modelTurn(label, String(p.message), refs, runId));
        return { runId };
      }
      case 'agent.wait': {
        const result = this.runs.get(String(p.runId));
        if (!result) throw Error('Unacknowledged fixture run');
        return result;
      }
      default: this.unexpected.push(method); throw Error('Unexpected gateway method: ' + method);
    }
  }
}
