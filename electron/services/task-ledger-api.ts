import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import { listManagedTasks, pageManagedTasks, readSessionTask, taskSystemCommand, openTaskSystem } from './task-system-service';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  TaskLedgerAddEdgePayload,
  TaskLedgerCreateNodePayload,
  TaskLedgerLinkSessionPayload,
  TaskLedgerReviewPayload,
  TaskLedgerSubmitCompletionPayload,
  TaskLedgerUpdateNodePayload,
} from '@shared/host-api/contract';
import type {
  TaskLedgerEdge,
  TaskLedgerEventInput,
  TaskLedgerNode,
  TaskLedgerSnapshot,
} from '../../shared/types/task-ledger';
import {
  appendTaskLedgerEvents,
  getTaskLedgerDir,
  loadTaskLedgerSnapshot,
  readTaskLedgerEvents,
} from './task-ledger-service';

function nowIso(): string {
  return new Date().toISOString();
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeNodeInput(payload: TaskLedgerCreateNodePayload): TaskLedgerNode {
  const createdAt = nowIso();
  const input = payload.node;
  return {
    id: payload.idempotencyKey ? createHash('sha256').update(`${payload.workspaceId??''}\0${payload.idempotencyKey}`).digest('hex') : randomUUID(),
    title: requireString(input.title, 'node.title'),
    kind: input.kind ?? 'task',
    parentId: input.parentId ?? null,
    status: input.status ?? 'todo',
    progress: input.progress,
    owner: input.owner ?? 'user',
    priority: input.priority ?? 'normal',
    tags: Array.isArray(input.tags) ? input.tags : [],
    description: input.description,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : undefined,
    metadata: input.metadata,
    createdAt,
    updatedAt: createdAt,
    completedAt: input.status === 'done' ? createdAt : null,
  };
}

function normalizeEdgeInput(payload: TaskLedgerAddEdgePayload): TaskLedgerEdge {
  const input = payload.edge;
  return {
    id: input.id ?? randomUUID(),
    from: requireString(input.from, 'edge.from'),
    to: requireString(input.to, 'edge.to'),
    type: input.type,
    label: input.label,
    metadata: input.metadata,
    createdAt: input.createdAt ?? nowIso(),
  };
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value)) {
    throw new Error(`${label} must be a sha256 digest`);
  }
  return value;
}

type CompletionOwnerReadResult =
  | { ok: true; taskId: string; priorStatus: string; claim: import('../../shared/types/task-ledger').TaskLedgerCompletionClaim;credential?:import('../../shared/task-system/types').TaskCredential }
  | { ok: false; reason: string };

/**
 * Completion callers provide references; runtime owners re-read their records.
 */
async function readCompletionClaimFromOwners(params: {
  workspaceId: string | null | undefined;
  refs: import('@shared/host-api/contract').TaskLedgerCompletionOwnerRefs;
  node: TaskLedgerNode | null;
  gateway?:GatewayManager;
}): Promise<CompletionOwnerReadResult> {
  if(!params.gateway||!params.workspaceId)return {ok:false,reason:'owner_receipt_readback_unavailable'};
  const store=await openTaskSystem(params.workspaceId);
  try{
    if(!store?.has(params.refs.taskId))return {ok:false,reason:'task_execution_contract_required'};
    const task=store.get(params.refs.taskId);if(!task.claim)return {ok:false,reason:'task_owner_missing'};
    return await params.gateway.rpc<CompletionOwnerReadResult>('tasks.contract.receipt',{workspaceDir:task.claim.worktree,refs:params.refs},15_000);
  }catch(error){return {ok:false,reason:error instanceof Error?error.message:String(error)};}finally{store?.close();}
}

function wrapSnapshot(snapshot: TaskLedgerSnapshot) {
  return { success: true, snapshot };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOfflineHtml(snapshot: TaskLedgerSnapshot, events: TaskLedgerEventInput[]): string {
  const data = JSON.stringify({ snapshot, events }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Task Ledger - ${escapeHtml(snapshot.workspaceId)}</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a}
body{margin:0}.shell{max-width:1180px;margin:0 auto;padding:24px}.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.tabs button{border:1px solid #cbd5e1;background:white;border-radius:8px;padding:8px 12px;cursor:pointer}.tabs button.active{background:#0f172a;color:white}.grid{display:grid;gap:12px}.node,.event,.edge{border:1px solid #dbe3ee;background:white;border-radius:8px;padding:12px}.muted{color:#64748b}.tag{display:inline-flex;border-radius:999px;background:#e2e8f0;padding:2px 8px;font-size:12px;margin-left:6px}.view{display:none}.view.active{display:block}.children{margin-left:22px;border-left:1px solid #dbe3ee;padding-left:12px}.dag{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.search{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:12px}@media (prefers-color-scheme:dark){:root{background:#09090b;color:#fafafa}.tabs button,.node,.event,.edge{background:#18181b;border-color:#27272a}.tabs button.active{background:#fafafa;color:#09090b}.muted{color:#a1a1aa}.tag{background:#27272a}.children{border-color:#27272a}.search{background:#18181b;color:#fafafa;border-color:#27272a}}
</style>
</head>
<body>
<main class="shell">
<div class="top"><div><h1>Task Ledger</h1><p class="muted">${escapeHtml(snapshot.workspaceId)} · ${snapshot.nodes.length} nodes · ${snapshot.eventsCount} events</p></div><p class="muted">${escapeHtml(snapshot.generatedAt)}</p></div>
<input id="search" class="search" placeholder="Search nodes, events, sessions" />
<div class="tabs"><button data-view="tree" class="active">Tree</button><button data-view="dag">DAG</button><button data-view="history">History</button><button data-view="review">Review</button></div>
<section id="tree" class="view active"></section>
<section id="dag" class="view"></section>
<section id="history" class="view"></section>
<section id="review" class="view"></section>
</main>
<script id="ledger-data" type="application/json">${data}</script>
<script>
const {snapshot,events}=JSON.parse(document.getElementById('ledger-data').textContent);
const byId=new Map(snapshot.nodes.map(n=>[n.id,n]));
const children=new Map(); for(const n of snapshot.nodes){const key=n.parentId||'root'; if(!children.has(key)) children.set(key,[]); children.get(key).push(n);}
let query='';
function matchText(value){return !query || JSON.stringify(value).toLowerCase().includes(query)}
function badge(text){return '<span class="tag">'+String(text||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))+'</span>'}
function nodeCard(n){return '<article class="node"><strong>'+n.title+'</strong>'+badge(n.kind)+badge(n.status)+'<p class="muted">'+(n.description||'')+'</p><p class="muted">'+n.id+'</p></article>'}
function renderTree(parent='root'){return (children.get(parent)||[]).filter(matchText).map(n=>nodeCard(n)+'<div class="children">'+renderTree(n.id)+'</div>').join('')}
function render(){document.getElementById('tree').innerHTML=renderTree()||'<p class="muted">No matching nodes.</p>';document.getElementById('dag').innerHTML='<div class="dag">'+snapshot.edges.filter(matchText).map(e=>'<article class="edge"><strong>'+((byId.get(e.from)||{}).title||e.from)+'</strong> '+badge(e.type)+' <strong>'+((byId.get(e.to)||{}).title||e.to)+'</strong><p class="muted">'+e.id+'</p></article>').join('')+'</div>';document.getElementById('history').innerHTML='<div class="grid">'+events.filter(matchText).slice().reverse().map(e=>'<article class="event"><strong>'+e.type+'</strong>'+badge(e.actor)+'<p class="muted">'+e.createdAt+'</p><pre>'+JSON.stringify(e.payload,null,2)+'</pre></article>').join('')+'</div>';document.getElementById('review').innerHTML=snapshot.reviewNodeIds.map(id=>byId.get(id)).filter(Boolean).filter(matchText).map(nodeCard).join('')||'<p class="muted">No review nodes.</p>'}
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===btn));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===btn.dataset.view))}));
document.getElementById('search').addEventListener('input',e=>{query=e.target.value.toLowerCase();render()}); render();
</script>
</body>
</html>`;
}

export function createTaskLedgerApi(gatewayManager?: GatewayManager): CompleteHostServiceRegistry['taskLedger'] {
  return {
    managedTasks: async (payload) => ({ success: true, tasks: await listManagedTasks(payload?.workspaceId) }),
    queryTasks: async (payload) => ({ success: true, ...await pageManagedTasks(payload?.workspaceId, payload) }),
    sessionTask: async (payload) => ({success:true,...await readSessionTask(payload.workspaceId,payload.sessionKey,gatewayManager,payload.expectedSessionGeneration)}),
    command: async (payload) => {
      try { return { success: true, result: await taskSystemCommand(payload.workspaceId,payload.command,gatewayManager) }; }
      catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    },
    snapshot: async (payload) => wrapSnapshot(await loadTaskLedgerSnapshot(payload?.workspaceId)),

    appendEvents: async (payload) => wrapSnapshot(
      await appendTaskLedgerEvents(payload.workspaceId, payload.events, payload.idempotencyKey),
    ),

    createNode: async (payload) => {
      const node = normalizeNodeInput(payload);
      const event: TaskLedgerEventInput = {
        type: node.kind === 'decision' ? 'decision_recorded' : node.kind === 'deviation' ? 'deviation_logged' : 'node_created',
        actor: 'user',
        taskId: node.id,
        payload: { node },
      };
      return wrapSnapshot(await appendTaskLedgerEvents(payload.workspaceId, [event], payload.idempotencyKey));
    },

    updateNode: async (payload: TaskLedgerUpdateNodePayload) => wrapSnapshot(
      await appendTaskLedgerEvents(payload.workspaceId, [{
        type: 'node_updated',
        actor: 'user',
        taskId: payload.nodeId,
        payload: { nodeId: payload.nodeId, patch: payload.patch },
      }], payload.idempotencyKey),
    ),

    addEdge: async (payload) => {
      const edge = normalizeEdgeInput(payload);
      const eventType = edge.type === 'depends_on' ? 'dependency_added' : 'edge_added';
      return wrapSnapshot(await appendTaskLedgerEvents(payload.workspaceId, [{
        type: eventType,
        actor: 'user',
        payload: { edge },
      }], payload.idempotencyKey));
    },

    linkSession: async (payload: TaskLedgerLinkSessionPayload) => wrapSnapshot(
      await appendTaskLedgerEvents(payload.workspaceId, [{
        type: 'session_linked',
        actor: 'user',
        taskId: payload.nodeId ?? null,
        sessionId: payload.sessionKey,
        payload: {
          sessionLink: {
            id: randomUUID(),
            nodeId: payload.nodeId ?? null,
            sessionKey: requireString(payload.sessionKey, 'sessionKey'),
            agentId: payload.agentId ?? null,
            traceId: payload.traceId ?? null,
            relation: payload.relation,
            sourceSessionKey: payload.sourceSessionKey ?? null,
            ...(payload.sessionGeneration ? { sessionGeneration: payload.sessionGeneration } : {}),
            summary: payload.summary,
            ...(typeof payload.handoffDepth === 'number' ? { handoffDepth: payload.handoffDepth } : {}),
            createdAt: nowIso(),
          },
        },
      }], payload.idempotencyKey),
    ),

    requestReview: async (payload: TaskLedgerReviewPayload) => wrapSnapshot(
      await appendTaskLedgerEvents(payload.workspaceId, [{
        type: 'review_requested',
        actor: 'user',
        taskId: payload.nodeId,
        payload: { nodeId: payload.nodeId, reviewReason: payload.reason },
      }], payload.idempotencyKey),
    ),

    clearReview: async (payload: TaskLedgerReviewPayload) => wrapSnapshot(
      await appendTaskLedgerEvents(payload.workspaceId, [{
        type: 'review_cleared',
        actor: 'user',
        taskId: payload.nodeId,
        payload: { nodeId: payload.nodeId, status: payload.status ?? 'todo' },
      }], payload.idempotencyKey),
    ),

    submitCompletion: async (payload: TaskLedgerSubmitCompletionPayload) => {
      const refs = payload.refs;
      const before = await loadTaskLedgerSnapshot(payload.workspaceId);
      if (
        !refs
        || refs.taskId.trim().length === 0
        || refs.generation.trim().length === 0
        || refs.verifierReceiptId.trim().length === 0
        || refs.effectReceiptId.trim().length === 0
      ) {
        return { success: false, accepted: false, reason: 'invalid_completion_binding', snapshot: before };
      }
      try {
        requireDigest(refs.candidateDigest, 'candidateDigest');
      } catch {
        return { success: false, accepted: false, reason: 'invalid_completion_digest', snapshot: before };
      }
      // The caller supplies identifiers only. Owner receipt readback is installed
      // by the completion service; until then this route fails closed rather than
      // trusting caller-authored verdict/effect fields.
      const claim = await readCompletionClaimFromOwners({
        workspaceId: payload.workspaceId,
        refs,
        node: before.nodes.find((candidate) => candidate.id === refs.taskId) ?? null,
        gateway:gatewayManager,
      });
      if (!claim.ok) {
        return { success: false, accepted: false, reason: claim.reason, snapshot: before };
      }
      const node = before.nodes.find((candidate) => candidate.id === refs.taskId);
      if (!node) {
        return { success: false, accepted: false, reason: 'task_not_found', snapshot: before };
      }
      if (node.status !== claim.claim.priorStatus) {
        return { success: false, accepted: false, reason: 'prior_status_mismatch', snapshot: before };
      }
      if (node.kind === 'check' || node.kind === 'review' || node.kind === 'decision') {
        return { success: false, accepted: false, reason: 'task_kind_not_eligible', snapshot: before };
      }
      if(claim.credential&&payload.workspaceId){
        await taskSystemCommand(payload.workspaceId,{action:'accept',credential:claim.credential,candidate:refs.candidateDigest},gatewayManager);
        return {success:true,accepted:true,snapshot:await loadTaskLedgerSnapshot(payload.workspaceId)};
      }
      const snapshot = await appendTaskLedgerEvents(payload.workspaceId, [{
        type: 'status_changed',
        actor: 'system',
        taskId: claim.taskId,
        payload: { nodeId: claim.claim.taskId, status: 'done', completionClaim: claim.claim },
      }], payload.idempotencyKey);
      return { success: true, accepted: true, snapshot };
    },

    exportHtml: async (payload) => {
      const workspaceId = payload?.workspaceId;
      const snapshot = await loadTaskLedgerSnapshot(workspaceId);
      const read = payload?.includeHistory === false
        ? { events: [], warnings: [] }
        : await readTaskLedgerEvents(workspaceId);
      const exportsDir = join(getTaskLedgerDir(workspaceId), 'exports');
      await mkdir(exportsDir, { recursive: true });
      const filePath = join(exportsDir, `task-ledger-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
      await writeFile(filePath, buildOfflineHtml(snapshot, read.events), 'utf8');
      return { success: true, path: filePath };
    },
  };
}
