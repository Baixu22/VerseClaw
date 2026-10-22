import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import {
  VG_RUNTIME_BINDING_SCHEMA,
  type VerseGitToolObservationRecord,
  type VerseGitToolObservationRequest,
  type VerseGitBindingAttachRequest,
  type VerseGitBindingEndReason,
  type VerseGitBindingEndRequest,
  type VerseGitBindingRecord,
  type VerseGitBindingRequest,
  type VerseGitBridgeEvent,
  type VerseGitRuntimeMode,
} from '../../shared/versegit-runtime-contract';
import { VerseGitObservationBridge, type ObservationIngestResult } from '../services/versegit-observation';

export type VerseGitBindingBridgeConfig = {
  enabled: boolean;
  port: number;
  token: string;
  ownerId: string;
  epoch: number;
  repoRoot: string | null;
  eventsPath: string | null;
  observationsPath?: string | null;
  observationBridge?: VerseGitObservationBridge;
};

const END_REASONS = new Set<VerseGitBindingEndReason>([
  'completed',
  'failed',
  'cancelled',
  'retry',
  'orchestration_completed',
  'orchestration_error',
  'timeout',
]);
const RUNTIME_MODES = new Set<VerseGitRuntimeMode>(['M1', 'M2']);

export function loadVerseGitBindingBridgeConfig(env: NodeJS.ProcessEnv = process.env): VerseGitBindingBridgeConfig {
  return {
    enabled: env.CLAWX_VERSGIT_BINDING_ENABLED === '1',
    port: Number(env.CLAWX_VERSGIT_BINDING_PORT ?? 0),
    token: env.CLAWX_VERSGIT_BINDING_TOKEN ?? '',
    ownerId: env.CLAWX_VERSGIT_OWNER_ID ?? '',
    epoch: Number(env.CLAWX_VERSGIT_EPOCH ?? 0),
    repoRoot: env.CLAWX_VERSGIT_ALLOWED_REPO_ROOT ?? null,
    eventsPath: env.CLAWX_VERSGIT_BINDING_EVENTS_PATH ?? null,
    observationsPath: env.CLAWX_VERSGIT_OBSERVATION_EVENTS_PATH ?? null,
  };
}

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function resolveVerseGitRepoIdentity(worktreePath: string): {
  repoId: string;
  worktreeId: string;
  canonicalWorktreePath: string;
} {
  const canonicalWorktreePath = realpathSync(worktreePath);
  const commonRaw = execFileSync(
    'git',
    ['-C', canonicalWorktreePath, 'rev-parse', '--git-common-dir'],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
  ).trim();
  const commonPath = realpathSync(resolve(canonicalWorktreePath, commonRaw));
  return {
    repoId: sha(commonPath.replaceAll('\\', '/').toLowerCase()),
    worktreeId: sha(canonicalWorktreePath.replaceAll('\\', '/').toLowerCase()),
    canonicalWorktreePath,
  };
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(`${JSON.stringify(value)}\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) throw new Error('request exceeds size limit');
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error('request body is required');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function opaque(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 300 && !/[\r\n\0]/u.test(value);
}

function reject(
  bridge: VerseGitBindingBridge,
  res: ServerResponse,
  kind: 'bind_rejected' | 'attach_rejected' | 'end_rejected',
  status: number,
  code: string,
  message: string,
  fields: Partial<VerseGitBridgeEvent> = {},
): void {
  bridge.emitRejected(kind, { ...fields, error: message });
  writeJson(res, status, { ok: false, error: { code, message } });
}

function toToolObservationRecord(result: ObservationIngestResult): VerseGitToolObservationRecord {
  const event = result.event;
  return {
    schema: 'clawx.versegit.tool-observation-result/v1',
    status: result.status === 'unobserved' ? 'partial' : result.status,
    why: result.why,
    issues: result.issues,
    binding: result.binding,
    event: event ? {
      eventId: event.eventId,
      runId: event.runId,
      traceId: event.traceId,
      agentSessionId: event.agentSessionId,
      vgSessionId: event.vgSessionId,
      repoId: event.repoId,
      worktreeId: event.worktreeId,
      ownerId: event.ownerId,
      epoch: event.epoch,
      surface: event.surface,
      operation: event.operation,
      effect: event.effect,
      status: event.status,
      coverage: event.coverage,
      path: event.path ?? null,
      lineStart: event.lineStart ?? null,
      lineEnd: event.lineEnd ?? null,
      basisDigest: event.basis ? `sha256:${sha(JSON.stringify(event.basis))}` : null,
      inputDigest: event.inputDigest,
      outputDigest: event.outputDigest,
      observedAt: event.endedAt ?? event.startedAt,
    } : null,
    host_verdict: 'unchanged',
  };
}

export class VerseGitBindingBridge {
  private readonly config: VerseGitBindingBridgeConfig;
  private readonly allowedRepoId: string | null;
  private server: Server | null = null;
  private readonly bindings = new Map<string, VerseGitBindingRecord>();
  private readonly requestBindings = new Map<string, string>();
  private readonly activeSessions = new Map<string, string>();
  private readonly observationBridge: VerseGitObservationBridge;

  constructor(config: VerseGitBindingBridgeConfig) {
    this.config = config;
    this.allowedRepoId = config.repoRoot ? resolveVerseGitRepoIdentity(config.repoRoot).repoId : null;
    this.observationBridge = config.observationBridge ?? new VerseGitObservationBridge();
  }

  get address(): string | null {
    const address = this.server?.address();
    return address && typeof address !== 'string' ? `http://127.0.0.1:${address.port}` : null;
  }

  async start(): Promise<string | null> {
    if (!this.config.enabled) return null;
    if (
      !this.config.token ||
      !Number.isInteger(this.config.port) ||
      this.config.port <= 0 ||
      this.config.port > 65535 ||
      !this.config.ownerId ||
      !Number.isInteger(this.config.epoch) ||
      this.config.epoch < 1 ||
      !this.allowedRepoId
    ) {
      throw new Error('VerseGit binding bridge configuration is incomplete');
    }
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        writeJson(res, 400, {
          ok: false,
          error: { code: 'INVALID_REQUEST', message: String(error).slice(0, 300) },
        });
      });
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.server!.once('error', rejectPromise);
      this.server!.listen(this.config.port, '127.0.0.1', () => resolvePromise());
    });
    return this.address;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolvePromise) => this.server!.close(() => resolvePromise()));
    this.server = null;
  }

  emitRejected(
    kind: 'bind_rejected' | 'attach_rejected' | 'end_rejected',
    fields: Partial<VerseGitBridgeEvent>,
  ): void {
    this.event(kind, fields);
  }

  private event(kind: VerseGitBridgeEvent['kind'], fields: Partial<VerseGitBridgeEvent> = {}): void {
    if (!this.config.eventsPath) return;
    const event: VerseGitBridgeEvent = {
      schema: 'clawx.versegit.bridge-event/v1',
      eventId: randomUUID(),
      at: new Date().toISOString(),
      driven_by: 'agent',
      actor: 'electron-main',
      kind,
      ...fields,
    };
    mkdirSync(dirname(this.config.eventsPath), { recursive: true });
    appendFileSync(this.config.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  private authorized(req: IncomingMessage): boolean {
    return req.headers.authorization === `Bearer ${this.config.token}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      writeJson(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'binding token is invalid' } });
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      writeJson(res, 200, { ok: true, data: { enabled: true, ownerId: this.config.ownerId, epoch: this.config.epoch, observationEnabled: Boolean(this.config.observationsPath) } });
      return;
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } });
      return;
    }
    const body = await readJson(req);
    if (req.url === '/bind') return this.handleBind(body, res);
    if (req.url === '/attach') return this.handleAttach(body, res);
    if (req.url === '/end') return this.handleEnd(body, res);
    if (req.url === '/observe') return this.handleObserve(body, res);
    writeJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown binding endpoint' } });
  }

  private handleBind(raw: unknown, res: ServerResponse): void {
    const identity = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as VerseGitBindingRequest
      : null;
    this.event('bind_requested', {
      requestId: identity?.requestId,
      runId: identity?.runId,
      traceId: identity?.traceId,
      agentSessionId: identity?.agentSessionId,
      ownerId: identity?.ownerId,
      epoch: identity?.epoch,
    });
    if (!identity) {
      reject(this, res, 'bind_rejected', 403, 'IDENTITY_MISMATCH', 'binding must be an object');
      return;
    }
    const issue = identity.schema !== VG_RUNTIME_BINDING_SCHEMA
      ? 'binding schema mismatch'
      : identity.ownerId !== this.config.ownerId
        ? 'owner identity mismatch'
        : identity.epoch !== this.config.epoch
          ? 'epoch is stale or mismatched'
          : !RUNTIME_MODES.has(identity.mode)
            ? 'runtime mode is not authorized'
            : !opaque(identity.requestId) ||
                !opaque(identity.runId) ||
                !opaque(identity.traceId) ||
                !opaque(identity.agentSessionId) ||
                !opaque(identity.worktreePath) ||
                (identity.taskNodeId !== undefined && !opaque(identity.taskNodeId))
              ? 'binding request identity is incomplete'
              : null;
    if (issue) {
      reject(this, res, 'bind_rejected', 403, 'IDENTITY_MISMATCH', issue, {
        requestId: identity.requestId,
        ownerId: identity.ownerId,
        epoch: identity.epoch,
      });
      return;
    }

    let repo: ReturnType<typeof resolveVerseGitRepoIdentity>;
    try {
      repo = resolveVerseGitRepoIdentity(identity.worktreePath);
    } catch (error) {
      reject(this, res, 'bind_rejected', 400, 'WORKSPACE_UNREACHABLE', String(error).slice(0, 300), {
        requestId: identity.requestId,
      });
      return;
    }
    if (this.allowedRepoId !== repo.repoId) {
      reject(this, res, 'bind_rejected', 403, 'WORKSPACE_MISMATCH', 'workspace is outside the allowed repository', {
        requestId: identity.requestId,
        repoId: repo.repoId,
        worktreeId: repo.worktreeId,
      });
      return;
    }

    const existingRequest = this.requestBindings.get(identity.requestId);
    if (existingRequest) {
      const record = this.bindings.get(existingRequest);
      const sameRequest = record !== undefined &&
        record.runId === identity.runId &&
        record.traceId === identity.traceId &&
        record.agentSessionId === identity.agentSessionId &&
        record.mode === identity.mode &&
        record.taskNodeId === identity.taskNodeId &&
        record.repoId === repo.repoId &&
        record.worktreeId === repo.worktreeId;
      if (!sameRequest) {
        reject(this, res, 'bind_rejected', 409, 'REQUEST_ID_CONFLICT', 'request id is already bound to a different identity', {
          requestId: identity.requestId,
          bindingId: record?.bindingId,
        });
        return;
      }
      if (record.phase === 'ended') {
        reject(this, res, 'bind_rejected', 409, 'BINDING_ENDED', 'request id binding has already ended', {
          requestId: identity.requestId,
          bindingId: record.bindingId,
        });
        return;
      }
      this.event('bound', {
        requestId: record.requestId,
        bindingId: record.bindingId,
        runId: record.runId,
        traceId: record.traceId,
        repoId: record.repoId,
        worktreeId: record.worktreeId,
        agentSessionId: record.agentSessionId,
        vgSessionId: record.vgSessionId,
        ownerId: record.ownerId,
        epoch: record.epoch,
        reason: 'idempotent-retry',
      });
      writeJson(res, 200, { ok: true, data: record });
      return;
    }

    const active = this.activeSessions.get(identity.agentSessionId);
    if (active) {
      reject(this, res, 'bind_rejected', 409, 'DUPLICATE_SESSION', 'agent session already has an active VG binding', {
        requestId: identity.requestId,
        bindingId: active,
        agentSessionId: identity.agentSessionId,
      });
      return;
    }

    const bindingId = randomUUID();
    const vgSessionId = `vg_${sha(`${identity.ownerId}\0${identity.agentSessionId}\0${bindingId}`).slice(0, 24)}`;
    const record: VerseGitBindingRecord = {
      schema: VG_RUNTIME_BINDING_SCHEMA,
      bindingId,
      requestId: identity.requestId,
      runId: identity.runId,
      traceId: identity.traceId,
      repoId: repo.repoId,
      worktreeId: repo.worktreeId,
      worktreePath: repo.canonicalWorktreePath,
      agentSessionId: identity.agentSessionId,
      vgSessionId,
      ownerId: identity.ownerId,
      epoch: identity.epoch,
      mode: identity.mode,
      phase: 'bound',
      createdAt: new Date().toISOString(),
      ...(identity.taskNodeId ? { taskNodeId: identity.taskNodeId } : {}),
    };
    this.bindings.set(bindingId, record);
    this.requestBindings.set(identity.requestId, bindingId);
    this.activeSessions.set(identity.agentSessionId, bindingId);
    this.event('bound', {
      requestId: record.requestId,
      bindingId,
      runId: record.runId,
      traceId: record.traceId,
      repoId: record.repoId,
      worktreeId: record.worktreeId,
      agentSessionId: record.agentSessionId,
      vgSessionId,
      ownerId: record.ownerId,
      epoch: record.epoch,
    });
    writeJson(res, 200, { ok: true, data: record });
  }

  private handleAttach(raw: unknown, res: ServerResponse): void {
    const request = raw as VerseGitBindingAttachRequest;
    this.event('attach_requested', {
      bindingId: request?.bindingId,
      ownerId: request?.ownerId,
      epoch: request?.epoch,
      childSessionKey: request?.childSessionKey,
      childRunId: request?.childRunId,
    });
    const record = request?.schema === VG_RUNTIME_BINDING_SCHEMA
      ? this.bindings.get(request.bindingId)
      : undefined;
    if (
      !record ||
      request.ownerId !== record.ownerId ||
      request.epoch !== record.epoch ||
      !opaque(request.childSessionKey) ||
      !opaque(request.childRunId)
    ) {
      reject(this, res, 'attach_rejected', 403, 'BINDING_MISMATCH', 'binding/owner/epoch mismatch', {
        bindingId: request?.bindingId,
        ownerId: request?.ownerId,
        epoch: request?.epoch,
      });
      return;
    }
    if (record.phase === 'ended') {
      reject(this, res, 'attach_rejected', 409, 'BINDING_ENDED', 'binding has already ended', {
        bindingId: record.bindingId,
        requestId: record.requestId,
      });
      return;
    }
    if (record.childRunId || record.childSessionKey) {
      if (record.childRunId === request.childRunId && record.childSessionKey === request.childSessionKey) {
        this.event('attached', {
          requestId: record.requestId,
          bindingId: record.bindingId,
          runId: record.runId,
          agentSessionId: record.agentSessionId,
          childSessionKey: record.childSessionKey,
          childRunId: record.childRunId,
          vgSessionId: record.vgSessionId,
          reason: 'idempotent-retry',
        });
        writeJson(res, 200, { ok: true, data: record });
        return;
      }
      reject(this, res, 'attach_rejected', 409, 'ALREADY_ATTACHED', 'binding is already attached to another worker', {
        bindingId: record.bindingId,
        requestId: record.requestId,
      });
      return;
    }
    record.childSessionKey = request.childSessionKey;
    record.childRunId = request.childRunId;
    record.phase = 'attached';
    this.bindings.set(record.bindingId, record);
    const observationBinding = this.observationBridge.bind({
      bindingId: record.bindingId,
      runId: record.childRunId,
      sessionKey: record.childSessionKey,
      traceId: record.traceId,
      requestId: record.requestId,
      repoId: record.repoId,
      worktreeId: record.worktreeId,
      worktreePath: record.worktreePath,
      agentSessionId: record.agentSessionId,
      vgSessionId: record.vgSessionId,
      ownerId: record.ownerId,
      actor: 'codex',
      epoch: record.epoch,
      boundAt: Date.now(),
    });
    this.event(observationBinding.status === 'attached' ? 'observation_bound' : 'observation_bind_rejected', {
      bindingId: record.bindingId,
      childRunId: record.childRunId,
      ownerId: record.ownerId,
      epoch: record.epoch,
      error: observationBinding.status === 'attached' ? undefined : observationBinding.issues.join(','),
    });
    this.event('attached', {
      requestId: record.requestId,
      bindingId: record.bindingId,
      runId: record.runId,
      agentSessionId: record.agentSessionId,
      childSessionKey: record.childSessionKey,
      childRunId: record.childRunId,
      vgSessionId: record.vgSessionId,
      reason: 'worker-spawned',
    });
    writeJson(res, 200, { ok: true, data: record });
  }

  private appendObservation(value: unknown): void {
    if (!this.config.observationsPath) return;
    mkdirSync(dirname(this.config.observationsPath), { recursive: true });
    appendFileSync(this.config.observationsPath, `${JSON.stringify(value)}\n`, 'utf8');
  }

  private handleObserve(raw: unknown, res: ServerResponse): void {
    const request = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as VerseGitToolObservationRequest
      : null;
    const record = request ? this.bindings.get(request.bindingId) : undefined;
    if (!request || !record || request.ownerId !== record.ownerId
      || request.epoch !== record.epoch || request.childRunId !== record.childRunId
      || !record.childSessionKey) {
      this.event('observation_rejected', {
        bindingId: request?.bindingId,
        childRunId: request?.childRunId,
        ownerId: request?.ownerId,
        epoch: request?.epoch,
        error: 'binding/owner/epoch mismatch',
      });
      writeJson(res, 403, { ok: false, error: { code: 'BINDING_MISMATCH', message: 'binding/owner/epoch mismatch' } });
      return;
    }
    const result = this.observationBridge.ingestToolObservation(request, {
      epoch: request.epoch,
      ownerId: request.ownerId,
      requestId: record.requestId,
      traceId: record.traceId,
      observedAt: Date.parse(request.observedAt),
    });
    const data = toToolObservationRecord(result);
    this.appendObservation({ kind: 'tool-observation', data });
    this.event(result.status === 'observed' || result.status === 'partial' ? 'observed' : 'observation_rejected', {
      bindingId: record.bindingId,
      childRunId: record.childRunId,
      requestId: record.requestId,
      ownerId: record.ownerId,
      epoch: record.epoch,
      reason: result.status,
      error: result.issues.join(',') || undefined,
    });
    writeJson(res, 200, { ok: true, data });
  }

  private handleEnd(raw: unknown, res: ServerResponse): void {
    const request = raw as VerseGitBindingEndRequest;
    this.event('end_requested', {
      bindingId: request?.bindingId,
      ownerId: request?.ownerId,
      epoch: request?.epoch,
      reason: request?.reason,
    });
    const record = request?.schema === VG_RUNTIME_BINDING_SCHEMA
      ? this.bindings.get(request.bindingId)
      : undefined;
    if (!record || request.ownerId !== record.ownerId || request.epoch !== record.epoch) {
      reject(this, res, 'end_rejected', 403, 'BINDING_MISMATCH', 'binding/owner/epoch mismatch', {
        bindingId: request?.bindingId,
        ownerId: request?.ownerId,
        epoch: request?.epoch,
      });
      return;
    }
    if (!END_REASONS.has(request.reason)) {
      reject(this, res, 'end_rejected', 400, 'INVALID_END_REASON', 'end reason is not recognized', {
        bindingId: record.bindingId,
        requestId: record.requestId,
      });
      return;
    }
    if (record.phase === 'ended') {
      reject(this, res, 'end_rejected', 409, 'BINDING_ENDED', 'binding has already ended', {
        bindingId: record.bindingId,
        requestId: record.requestId,
      });
      return;
    }
    const endedAt = new Date().toISOString();
    record.phase = 'ended';
    record.endedAt = endedAt;
    record.endReason = request.reason;
    this.bindings.set(record.bindingId, record);
    this.activeSessions.delete(record.agentSessionId);
    if (record.childRunId) {
      const seal = this.observationBridge.detach(record.childRunId, {
        epoch: record.epoch,
        ownerId: record.ownerId,
        reason: request.reason,
        at: Date.parse(endedAt),
      });
      this.appendObservation({ kind: 'session-seal', ...seal });
      this.event('observation_sealed', {
        bindingId: record.bindingId,
        childRunId: record.childRunId,
        ownerId: record.ownerId,
        epoch: record.epoch,
        reason: request.reason,
        error: seal.status === 'detached' ? undefined : seal.issues.join(','),
      });
    }
    this.event('ended', {
      requestId: record.requestId,
      bindingId: record.bindingId,
      runId: record.runId,
      agentSessionId: record.agentSessionId,
      childSessionKey: record.childSessionKey,
      childRunId: record.childRunId,
      vgSessionId: record.vgSessionId,
      reason: request.reason,
    });
    writeJson(res, 200, { ok: true, data: { bindingId: record.bindingId, endedAt, reason: request.reason } });
  }
}

let bridge: VerseGitBindingBridge | null = null;

export async function ensureVerseGitBindingBridge(): Promise<VerseGitBindingBridge | null> {
  if (!bridge) {
    const config = loadVerseGitBindingBridgeConfig();
    bridge = new VerseGitBindingBridge(config);
    const address = await bridge.start();
    if (address) process.env.CLAWX_VERSGIT_RUNTIME_BINDING_URL = address;
    const { app } = await import('electron');
    app.once('before-quit', () => { void bridge?.stop(); });
  }
  return bridge;
}

export function resetVerseGitBindingBridgeForTest(): void {
  bridge = null;
}
