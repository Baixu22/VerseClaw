import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import { applyTaskLedgerAgentAction } from './task-ledger-actions';
import { readCurrentTaskLedgerCompletions, submitTaskLedgerCompletionClaim } from './task-ledger-completion';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  TaskLedgerAddEdgePayload,
  TaskLedgerCreateNodePayload,
  TaskLedgerLinkSessionPayload,
  TaskLedgerReviewPayload,
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
    id: randomUUID(),
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

function rejectCallerCompletion(payload: { patch?: Record<string, unknown>; node?: Partial<TaskLedgerNode>; completionDecision?: unknown; type?: string }) {
  // Runtime recorder provenance cannot be borrowed by a caller to bypass the
  // automatic business completion fence; internal recorders write the service.
  if ([payload.node?.metadata, payload.patch?.metadata].some(metadata =>
    metadata && typeof metadata === 'object' && 'runtimeLifecycle' in metadata)) {
    throw Object.assign(new Error('Runtime lifecycle provenance is owned by the runtime recorder'), { code: 'VALIDATION' });
  }
  if (payload.type === 'completion_decided' || payload.completionDecision
    || payload.node && ('completionDecision' in payload.node || 'completionReadback' in payload.node)
    || payload.patch && ('completionDecision' in payload.patch || 'completionReadback' in payload.patch)) {
    throw Object.assign(new Error('Completion decisions are owned by Task Ledger claim admission'), { code: 'VALIDATION' });
  }
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

export function createTaskLedgerApi(options: { gatewayManager?: Pick<GatewayManager, 'rpc' | 'getStatus'> } = {}): CompleteHostServiceRegistry['taskLedger'] {
  const wrapSnapshot = async (snapshot: TaskLedgerSnapshot) => ({ success: true as const, snapshot: await readCurrentTaskLedgerCompletions(options.gatewayManager, snapshot) });
  return {
    submitCompletion: payload => submitTaskLedgerCompletionClaim(options.gatewayManager, payload),
    applyAgentAction: async payload => {
      const result = await applyTaskLedgerAgentAction(options.gatewayManager, payload);
      return { ...result, ...await wrapSnapshot(result.snapshot) };
    },
    snapshot: async (payload) => wrapSnapshot(await loadTaskLedgerSnapshot(payload?.workspaceId)),

    appendEvents: async (payload) => {
      for (const event of payload.events) {
        rejectCallerCompletion({ ...event.payload, type: event.type });
        if (event.actor === 'system') {
          throw Object.assign(new Error('Internal runtime actors append through their existing owner'), { code: 'VALIDATION' });
        }
      }
      return wrapSnapshot(await appendTaskLedgerEvents(payload.workspaceId, payload.events, payload.idempotencyKey));
    },

    createNode: async (payload) => {
      rejectCallerCompletion(payload);
      const node = normalizeNodeInput(payload);
      const event: TaskLedgerEventInput = {
        type: node.kind === 'decision' ? 'decision_recorded' : node.kind === 'deviation' ? 'deviation_logged' : 'node_created',
        actor: 'user',
        taskId: node.id,
        payload: { node },
      };
      return wrapSnapshot(await appendTaskLedgerEvents(payload.workspaceId, [event], payload.idempotencyKey));
    },

    updateNode: async (payload: TaskLedgerUpdateNodePayload) => {
      rejectCallerCompletion(payload);
      return wrapSnapshot(await appendTaskLedgerEvents(payload.workspaceId, [{
        type: 'node_updated',
        actor: 'user',
        taskId: payload.nodeId,
        payload: { nodeId: payload.nodeId, patch: payload.patch },
      }], payload.idempotencyKey));
    },

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

    exportHtml: async (payload) => {
      const workspaceId = payload?.workspaceId;
      const snapshot = await readCurrentTaskLedgerCompletions(options.gatewayManager, await loadTaskLedgerSnapshot(workspaceId));
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
