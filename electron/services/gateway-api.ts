import { assertSensitiveCaptureAllowed } from './sensitive-capture-gate';
import type { GatewayManager } from '../gateway/manager';
import type { ResourceFabric } from './resource-fabric';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createHash } from 'node:crypto';
import type {
  KnowledgeCreateInboxItemPayload,
  KnowledgeDraftType,
  KnowledgeSourceRef,
} from '../../shared/host-api/contract';
import type {
  MissionEvidenceRef,
  MissionMemoryCandidate,
  MissionReviewerResult,
  MissionRunRecord,
  MissionStatus,
  MissionTickRecord,
} from '../../shared/types/mission-control';
import { PORTS } from '../utils/config';
import { scheduleControlUiDeviceAutoApproval } from '../utils/control-ui-device-pairing';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { openExternalSafe } from '../utils/safe-open-external';
import { clipboard } from 'electron';
import { getSetting } from '../utils/store';
import { handleMockChatSend, handleMockSessionSend } from './mock-provider';
import { isRecord } from './payload-utils';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionDecisionEvent,
  recordPermissionAudit,
} from './permissions-api';
import {
  extractMaxWorkers,
  extractRequestedRoles,
  extractTemplateId,
  listActiveOrchestrationPresets,
  matchOrchestrationPreset,
} from './orchestration-presets-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { createWorkspacePermissionDecisionEvent } from './permission-decision-audit';
import { createSandboxDenialDetails, type SandboxDenialDetails } from '@shared/sandbox/errors';
import { decideGatewayRpc, isApprovalRisk } from './workspace-permissions';
import {
  classifyGatewayMethodForSandboxGate,
  composeWithSandboxHighRiskGate,
  decideSandboxHighRiskAction,
  loadSandboxHighRiskPolicy,
} from '@electron/utils/sandbox-high-risk-gate';

type HealthPayload = {
  probe?: unknown;
};

type ControlUiPayload = {
  view?: unknown;
};

type RpcPayload = {
  method?: unknown;
  params?: unknown;
  timeoutMs?: unknown;
  approvalId?: unknown;
};

type GatewayApiOptions = {
  createKnowledgeInboxItem?: CompleteHostServiceRegistry['knowledge']['createInboxItem'];
};

function parseTimeoutMs(timeoutMs: unknown): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid gateway RPC timeout');
  }
  return timeoutMs;
}

function normalizeApprovalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function buildGatewayRequestHash(method: string, params: unknown): string {
  return `${method}:${stableJson(params ?? null)}`;
}

function buildParamsPreview(params: unknown): string | undefined {
  if (params === undefined) return undefined;
  const value = stableJson(params);
  return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
}

function runGatewayRpc(
  gatewayManager: GatewayManager,
  resourceFabricInstance: ResourceFabric,
  method: string,
  params: unknown,
  timeoutMs: number | undefined,
): Promise<unknown> {
  return resourceFabricInstance.run(
    method,
    params,
    timeoutMs,
    (rpcMethod, rpcParams, rpcTimeoutMs) => gatewayManager.rpc(rpcMethod, rpcParams, rpcTimeoutMs),
  );
}

const KNOWLEDGE_INTERACTION_MVP_VERSION = 'knowledge-interaction-mvp-1';

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function readMissionRecord(result: unknown): MissionRunRecord | null {
  const record = isRecord(result) ? result as Record<string, unknown> : {};
  const mission = isRecord(record.mission) ? record.mission as Record<string, unknown> : record;
  return typeof mission.missionId === 'string' && Array.isArray(mission.ticks)
    ? mission as unknown as MissionRunRecord
    : null;
}

function missionEvidenceLabel(ref: MissionEvidenceRef): string {
  return ref.label ?? `${ref.type}:${ref.ref}`;
}

function sourceRefFromMissionEvidence(ref: MissionEvidenceRef): KnowledgeSourceRef {
  const label = missionEvidenceLabel(ref);
  switch (ref.type) {
    case 'task_ledger':
      return { id: ref.ref, kind: 'task_ledger', label };
    case 'trace':
      return { id: `trace:${ref.ref}`, kind: 'trace', label };
    case 'task_loop':
      return { id: `task_loop:${ref.ref}`, kind: 'task_loop', label };
    case 'session':
      return { id: ref.ref, kind: 'chat', label };
    case 'file':
      return { id: ref.ref, kind: 'file', path: ref.ref, label };
    case 'memory':
      return { id: ref.ref, kind: 'wiki', label };
    case 'manual':
      return { id: ref.ref, kind: 'manual', label };
    default:
      return { id: `${ref.type}:${ref.ref}`, kind: 'other', label };
  }
}

function knowledgeCandidateCaptureHash(candidate: MissionMemoryCandidate): string {
  return createHash('sha256')
    .update(JSON.stringify({
      summary: candidate.summary.trim(),
      evidenceRefs: [...(candidate.evidenceRefs ?? [])].map((ref) => ref.trim()).filter(Boolean).sort(),
    }))
    .digest('hex')
    .slice(0, 16);
}

function knowledgeCandidateCaptureKey(record: MissionRunRecord, tick: MissionTickRecord, candidate: MissionMemoryCandidate): string {
  return `mission:${record.missionId}:tick:${tick.tick}:knowledge:${knowledgeCandidateCaptureHash(candidate)}`;
}

function collectMissionKnowledgeSourceRefs(record: MissionRunRecord, tick: MissionTickRecord, candidate: MissionMemoryCandidate): KnowledgeSourceRef[] {
  const refs = new Map<string, KnowledgeSourceRef>();
  const allEvidence = [...(record.evidenceRefs ?? []), ...(tick.evidenceRefs ?? [])];
  const evidenceByRef = new Map(allEvidence.map((ref) => [ref.ref, ref]));

  for (const ref of allEvidence) {
    const source = sourceRefFromMissionEvidence(ref);
    refs.set(source.id, source);
  }
  for (const evidenceRef of candidate.evidenceRefs ?? []) {
    const known = evidenceByRef.get(evidenceRef);
    const source = known
      ? sourceRefFromMissionEvidence(known)
      : { id: evidenceRef, kind: 'manual' as const, label: evidenceRef };
    refs.set(source.id, source);
  }

  const metadata = isRecord((record as unknown as Record<string, unknown>).metadata)
    ? (record as unknown as Record<string, unknown>).metadata as Record<string, unknown>
    : {};
  const taskLedgerRootId = typeof metadata.taskLedgerRootId === 'string' ? metadata.taskLedgerRootId : undefined;
  if (taskLedgerRootId) {
    refs.set(taskLedgerRootId, { id: taskLedgerRootId, kind: 'task_ledger', label: 'Mission Task Ledger root' });
  }

  return [...refs.values()].slice(0, 12);
}

function titleFromKnowledgeCandidate(candidate: MissionMemoryCandidate): string {
  const firstLine = candidate.summary.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  if (!firstLine) return 'Mission knowledge candidate';
  return firstLine.length <= 88 ? firstLine : `${firstLine.slice(0, 85)}...`;
}

function temporalityFromSummary(summary: string): 'stable' | 'versioned' | 'ephemeral' {
  if (/temporary|workaround|hack|临时|绕过/u.test(summary)) return 'ephemeral';
  if (/v\d+|version|migration|upgrade|Next\.js|React|TypeScript|版本|迁移|升级/u.test(summary)) return 'versioned';
  return 'stable';
}

function typeFromKnowledgeCandidate(candidate: MissionMemoryCandidate, failed: boolean): KnowledgeDraftType {
  const text = candidate.summary.toLowerCase();
  if (failed || /error|failed|failure|blocked|bug|排障|故障|失败|错误/u.test(text)) return 'troubleshooting';
  if (/decision|rationale|chose|chosen|选择|决策|取舍/u.test(text)) return 'decision';
  if (/workflow|procedure|steps|流程|步骤/u.test(text)) return 'procedure';
  if (/architecture|架构/u.test(text)) return 'architecture';
  return 'synthesis';
}

function missionOutcomeFromReviewer(record: MissionRunRecord, tick: MissionTickRecord, reviewer: MissionReviewerResult): MissionStatus {
  if (reviewer.decision === 'complete') return 'complete';
  if (reviewer.decision === 'blocked') return 'blocked';
  if (reviewer.decision === 'ask_user') return 'ask_user';
  return tick.status ?? record.status;
}

function scoreMissionKnowledgeCandidate(params: {
  record: MissionRunRecord;
  tick: MissionTickRecord;
  reviewer: MissionReviewerResult;
  sourceRefs: KnowledgeSourceRef[];
  failed: boolean;
  captureKey: string;
}) {
  const { record, tick, reviewer, sourceRefs, failed, captureKey } = params;
  const strongEvidence = sourceRefs.some((ref) => (
    ref.kind === 'task_ledger'
    || ref.kind === 'file'
    || ref.kind === 'trace'
    || ref.kind === 'task_loop'
    || ref.id.startsWith('trace:')
    || ref.id.startsWith('task_loop:')
  ));
  const validated = reviewer.validationState?.status === 'passed' || reviewer.acceptanceStatus?.status === 'satisfied';
  const complete = reviewer.decision === 'complete' || record.status === 'complete';
  const recommendation = failed
    ? 'archive-only'
    : complete && (validated || strongEvidence)
      ? 'save'
      : 'review';
  const reusability = recommendation === 'save' ? 0.82 : recommendation === 'review' ? 0.62 : 0.58;
  const uniqueness = 0.5;
  const confidence = recommendation === 'save' ? (validated ? 0.86 : 0.76) : recommendation === 'review' ? 0.55 : 0.48;
  const reason = recommendation === 'save'
    ? 'Mission completed with reusable evidence-backed knowledge.'
    : recommendation === 'archive-only'
      ? 'Mission did not fully succeed; keep the lesson reviewable without formal wiki writes.'
      : 'Mission produced a reusable lesson, but evidence or validation needs user review.';

  return {
    mvpVersion: KNOWLEDGE_INTERACTION_MVP_VERSION,
    recommendation,
    score: {
      reusability: clampScore(reusability),
      uniqueness: clampScore(uniqueness),
      confidence: clampScore(confidence),
      overall: clampScore((reusability * 0.4) + (uniqueness * 0.2) + (confidence * 0.4)),
    },
    temporality: 'stable' as const,
    reason,
    missionId: record.missionId,
    tick: tick.tick,
    outcome: missionOutcomeFromReviewer(record, tick, reviewer),
    evidenceRefs: sourceRefs.map((ref) => ref.id),
    captureKey,
  };
}

function buildMissionKnowledgeInboxPayload(
  record: MissionRunRecord,
  tick: MissionTickRecord,
  reviewer: MissionReviewerResult,
  candidate: MissionMemoryCandidate,
): KnowledgeCreateInboxItemPayload {
  const failed = record.status === 'blocked'
    || record.status === 'error'
    || tick.status === 'blocked'
    || tick.status === 'error'
    || reviewer.decision === 'blocked';
  const sourceRefs = collectMissionKnowledgeSourceRefs(record, tick, candidate);
  const captureKey = knowledgeCandidateCaptureKey(record, tick, candidate);
  const metadata = scoreMissionKnowledgeCandidate({ record, tick, reviewer, sourceRefs, failed, captureKey });
  return {
    title: titleFromKnowledgeCandidate(candidate),
    body: candidate.summary,
    kind: sourceRefs.some((ref) => ref.kind === 'task_ledger') ? 'task-ledger' : 'chat-session',
    type: typeFromKnowledgeCandidate(candidate, failed),
    sourceRefs,
    sourceIds: sourceRefs.map((ref) => ref.id),
    tags: ['mission-control', 'knowledge-interaction-mvp'],
    workspaceId: record.workspaceId ?? null,
    agentId: record.agentId ?? null,
    createdBy: 'agent',
    warnings: sourceRefs.length === 0 ? ['Mission knowledge candidate has no evidence references.'] : [],
    metadata: {
      ...metadata,
      temporality: temporalityFromSummary(candidate.summary),
    },
  };
}

async function captureMissionKnowledgeCandidates(
  method: string,
  result: unknown,
  createKnowledgeInboxItem: GatewayApiOptions['createKnowledgeInboxItem'],
  capturedKeys: Set<string>,
): Promise<void> {
  if (!createKnowledgeInboxItem || (method !== 'mission.run' && method !== 'mission.tick')) return;
  const mission = readMissionRecord(result);
  if (!mission) return;
  for (const tick of mission.ticks ?? []) {
    const reviewer = tick.reviewer;
    if (!reviewer) continue;
    for (const candidate of reviewer.memoryCandidates ?? []) {
      if (candidate.kind !== 'knowledge_draft' || !candidate.summary.trim()) continue;
      const key = knowledgeCandidateCaptureKey(mission, tick, candidate);
      if (capturedKeys.has(key)) continue;
      try {
        const response = await createKnowledgeInboxItem(buildMissionKnowledgeInboxPayload(mission, tick, reviewer, candidate));
        if (isRecord(response) && response.success === false) continue;
        capturedKeys.add(key);
      } catch {
        // Knowledge capture is best-effort and must not fail the Gateway RPC.
      }
    }
  }
}

export function createGatewayApi(
  gatewayManager: GatewayManager,
  resourceFabricInstance: ResourceFabric,
  options: GatewayApiOptions = {},
): CompleteHostServiceRegistry['gateway'] {
  const capturedMissionKnowledgeKeys = new Set<string>();
  const runRpcAndCaptureKnowledge = async (
    method: string,
    params: unknown,
    timeoutMs: number | undefined,
  ) => {
    const result = await runGatewayRpc(gatewayManager, resourceFabricInstance, method, params, timeoutMs);
    await captureMissionKnowledgeCandidates(method, result, options.createKnowledgeInboxItem, capturedMissionKnowledgeKeys);
    return result;
  };

  return {
    status: () => gatewayManager.getStatus(),
    start: async () => {
      await gatewayManager.start();
      return { success: true };
    },
    stop: async () => {
      await gatewayManager.stop();
      return { success: true };
    },
    restart: async () => {
      await gatewayManager.restart();
      return { success: true };
    },
    health: async (payload) => {
      const body = isRecord(payload) ? payload as HealthPayload : {};
      return gatewayManager.checkHealth({ probe: body.probe === true });
    },
    controlUi: async (payload) => {
      // P4-001 A2: never return gateway token (or token-bearing URL) to Renderer.
      const body = isRecord(payload) ? payload as ControlUiPayload & { open?: unknown } : {};
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const view = body.view === 'dreams' ? 'dreams' : undefined;
      const shouldOpen = body.open !== false;
      scheduleControlUiDeviceAutoApproval(gatewayManager);
      let opened = false;
      if (shouldOpen) {
        const url = buildOpenClawControlUiUrl(port, token, { view });
        await openExternalSafe(url);
        opened = true;
      }
      return {
        success: true,
        port,
        opened,
        hasToken: Boolean(typeof token === 'string' && token.trim()),
      };
    },
    copyGatewayToken: async () => {
      // Main-owned clipboard write — token never crosses the host-api response boundary.
      const token = await getSetting('gatewayToken');
      const trimmed = typeof token === 'string' ? token.trim() : '';
      if (!trimmed) {
        throw new Error('Gateway token unavailable');
      }
      await assertSensitiveCaptureAllowed('clipboard');
      clipboard.writeText(trimmed);
      return { success: true };
    },
    rpc: async (payload) => {
      let body = isRecord(payload) ? payload as RpcPayload : {};
      const method = typeof body.method === 'string' ? body.method.trim() : '';
      if (!method) {
        throw new Error('Invalid gateway RPC method');
      }
      const timeoutMs = parseTimeoutMs(body.timeoutMs);
      const approvalId = normalizeApprovalId(body.approvalId);
      const workspace = await getActiveWorkspaceProfile();

      if (method === 'tools.invoke' && workspace) {
        const params = isRecord(body.params) ? { ...body.params } : {};
        const sessionKey = typeof params.sessionKey === 'string' ? params.sessionKey : workspace.activeSessionKey;
        const binding = Object.values(workspace.agentBindings ?? {}).find((entry) => entry.sessionKey === sessionKey);
        const agentId = binding?.agentId ?? workspace.selectedAgentId ?? workspace.agentId;
        if ((!binding && sessionKey !== workspace.activeSessionKey) || (params.agentId !== undefined && params.agentId !== agentId)
          || (params.workspaceDir !== undefined && params.workspaceDir !== workspace.rootPath)) {
          return { success: false, blocked: true, errorCode: 'VALIDATION', error: 'Tool invocation differs from the active workspace binding' };
        }
        body = { ...body, params: { ...params, sessionKey, agentId, workspaceDir: workspace.rootPath } };
      }

      if (method === 'mcp.listTools' || method === 'mcp.heartbeat' || method === 'mcp.callTool') {
        const params = isRecord(body.params) ? body.params : {};
        const sessionKey = typeof params.sessionKey === 'string' ? params.sessionKey : '';
        const binding = Object.values(workspace?.agentBindings ?? {}).find((entry) => entry.sessionKey === sessionKey);
        const agentId = binding?.agentId ?? workspace?.selectedAgentId ?? workspace?.agentId;
        // Recheck the Main owner at the permission gate so a queued request cannot
        // borrow another workspace's permission after the UI context changes.
        if (!workspace || params.workspaceId !== workspace.id || params.workspaceDir !== workspace.rootPath
          || !sessionKey || (!binding && sessionKey !== workspace.activeSessionKey) || params.agentId !== agentId
          || typeof params.expectedSessionGeneration !== 'string' || !params.expectedSessionGeneration.trim()) {
          return { success: false, blocked: true, errorCode: 'VALIDATION', error: 'MCP request is not bound to the active workspace and assistant' };
        }
      }

      if (workspace) {
        let decision = decideGatewayRpc(method, workspace.permissionMode, body.params);
        let sandboxDenial: SandboxDenialDetails | undefined;
        const sandboxClass = classifyGatewayMethodForSandboxGate(method);
        if (sandboxClass) {
          const sandboxPolicy = await loadSandboxHighRiskPolicy();
          const sandboxDecision = decideSandboxHighRiskAction(sandboxPolicy, sandboxClass, { allowApproval: true });
          if (!sandboxDecision.allowed && !sandboxDecision.requiresApproval) {
            sandboxDenial = createSandboxDenialDetails({
              mechanism: 'sandbox-gate',
              operation: sandboxClass,
              requestedProviderId: sandboxPolicy.requestedProviderId,
              effectiveProviderId: sandboxPolicy.effectiveProviderId,
              runtimeLevel: sandboxPolicy.runtimeLevel,
            });
          }
          decision = composeWithSandboxHighRiskGate(decision, sandboxDecision);
          if (sandboxDecision.forceVisible || !sandboxDecision.allowed) {
            void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
              workspaceMode: workspace.permissionMode,
              tool: method,
              boundary: 'sandbox-runtime',
              requestId: approvalId ?? buildGatewayRequestHash(method, body.params),
              decision,
            }));
          }
        }
        void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
          workspaceMode: workspace.permissionMode,
          tool: method,
          boundary: 'gateway-rpc',
          requestId: approvalId ?? buildGatewayRequestHash(method, body.params),
          decision,
        }));
        if (!decision.allowed) {
          if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
            const requestHash = buildGatewayRequestHash(method, body.params);

            // Area 3 §3.3: Trusted Orchestration Presets — for orchestrator.run,
            // check whether an active workspace preset covers this exact shape
            // (templateId + role set + maxWorkers). If yes, auto-approve and
            // record an audit line ("approved by preset X"). Exceeding the
            // preset in any dimension falls through to the normal dialog.
            // Store read failure → no presets → normal flow (degrade to today).
            if (method === 'orchestrator.run') {
              try {
                const presets = await listActiveOrchestrationPresets(workspace.id);
                if (presets.length > 0) {
                  const matchResult = matchOrchestrationPreset(presets, {
                    workspaceId: workspace.id,
                    templateId: extractTemplateId(body.params),
                    requestedRoles: extractRequestedRoles(body.params),
                    maxWorkers: extractMaxWorkers(body.params),
                  });
                  if (matchResult.matched && matchResult.preset) {
                    void recordPermissionAudit({
                      workspace,
                      source: 'gateway',
                      risk: decision.risk,
                      command: method,
                      requestHash,
                      paramsPreview: buildParamsPreview(body.params),
                      reason: `approved by preset ${matchResult.preset.label} (${matchResult.preset.id})`,
                    });
                    return runRpcAndCaptureKnowledge(method, body.params, timeoutMs);
                  }
                }
              } catch {
                // Preset check is best-effort; any error → fall through to
                // the normal approval flow so the gate is never weakened.
              }
            }

            if (approvalId) {
              const approved = await consumeApprovedPermissionApproval({
                id: approvalId,
                workspaceId: workspace.id,
                source: 'gateway',
                command: method,
                requestHash,
              });
              if (approved) {
                return runRpcAndCaptureKnowledge(method, body.params, timeoutMs);
              }
            }

            const approval = await createPermissionApproval({
              workspace,
              source: 'gateway',
              risk: decision.risk,
              command: method,
              requestHash,
              paramsPreview: buildParamsPreview(body.params),
              reason: decision.reason,
            });
            return {
              success: false,
              blocked: true,
              approvalRequired: true,
              approval,
              ...(sandboxDenial ? { sandboxDenial } : {}),
              error: decision.reason ?? 'Gateway 请求需要审批',
            };
          }
          return {
            success: false,
            blocked: true,
            ...(sandboxDenial ? { sandboxDenial } : {}),
            error: decision.reason ?? 'Gateway 请求已被当前权限模式阻止',
          };
        }

        if (workspace.permissionMode === 'fullAccess' && isApprovalRisk(decision.risk)) {
          void recordPermissionAudit({
            workspace,
            source: 'gateway',
            risk: decision.risk,
            command: method,
            requestHash: buildGatewayRequestHash(method, body.params),
            paramsPreview: buildParamsPreview(body.params),
            reason: '完全访问模式下执行高风险 Gateway 请求',
          });
        }
      }

      if (method === 'chat.send') {
        const mockResult = handleMockChatSend(body.params);
        if (mockResult) return mockResult;
      }
      if (method === 'sessions.send') {
        const mockResult = handleMockSessionSend(body.params);
        if (mockResult) return mockResult;
      }

      return runRpcAndCaptureKnowledge(method, body.params, timeoutMs);
    },
  };
}
