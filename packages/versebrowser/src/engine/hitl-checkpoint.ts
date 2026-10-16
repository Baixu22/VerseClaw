/**
 * HITL checkpoints + session persistence (TF-0039).
 *
 * When automation hits a human-only gate (captcha, login wall, 2FA, ToS), it
 * **pauses** with an audit event — it never bypasses. After the human acts,
 * the host calls resume() and the session continues.
 *
 * Secrets never land in plaintext: checkpoints store only vault **references**.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getWorkspaceSessionsRoot } from '../host/workspace-paths.ts';

/**
 * Every accepted gate reason, declared once so the store, the MCP input schema and the docs cannot
 * drift apart. `HUMAN_ONLY_GATES` below is the subset that must never be auto-solved.
 */
export const HITL_REASONS = [
  'captcha_human_required',
  'login_wall',
  'mfa',
  'tos_review',
  'boundary_confirm',
  'other',
] as const;

export type HitlReason = (typeof HITL_REASONS)[number];

export type HitlAuditEvent = {
  at: string;
  event: 'pause' | 'resume' | 'credential_ref' | 'deny';
  sessionId: string;
  reason?: HitlReason;
  detail?: string;
};

export type HitlCheckpoint = {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  status: 'paused' | 'running' | 'completed' | 'aborted';
  reason: HitlReason;
  message: string;
  createdAt: string;
  updatedAt: string;
  /** Vault credential ids only — never passwords. */
  credentialRefs: string[];
  /**
   * TF-0167: salted hash of the one-time resume token. The raw token is never stored on the
   * checkpoint and never persisted, so reading the checkpoint (or the sessions directory) cannot
   * replay a human gate. The raw token is handed to the human operator channel once, at pause time.
   */
  resumeTokenHash: string;
  resumeTokenSalt: string;
  audit: HitlAuditEvent[];
};

export type PauseInput = {
  sessionId: string;
  reason: HitlReason;
  message: string;
  credentialRefs?: string[];
};

function now(): string {
  return new Date().toISOString();
}

/** Salted hash: the checkpoint only ever holds this, never the token itself. */
function hashResumeToken(salt: string, token: string): string {
  return createHash('sha256').update(`${salt}:${token}`).digest('hex');
}

export class HitlSessionStore {
  private readonly root: string;
  private readonly checkpoints = new Map<string, HitlCheckpoint>();

  constructor(root?: string) {
    this.root = root ?? getWorkspaceSessionsRoot();
  }

  private safeId(sessionId: string): string {
    return sessionId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'session';
  }

  private pathFor(sessionId: string): string {
    return join(this.root, this.safeId(sessionId), 'hitl-checkpoint.json');
  }

  /**
   * The human operator channel: where the one-time resume token is dropped for a person to read.
   *
   * Deliberately a different path from the checkpoint the product manages, so no agent-facing
   * surface that reads product state ever yields a usable token. This is a channel separation, not
   * a cryptographic boundary: a caller with raw filesystem access can still read the file.
   */
  operatorTokenPath(sessionId: string): string {
    return join(this.root, '_operator', `${this.safeId(sessionId)}.resume-token`);
  }

  /** Read the token the human operator was given. Agent-facing surfaces never call this. */
  async readOperatorResumeToken(sessionId: string): Promise<string | undefined> {
    try {
      return (await readFile(this.operatorTokenPath(sessionId), 'utf8')).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async writeOperatorResumeToken(sessionId: string, token: string): Promise<void> {
    const path = this.operatorTokenPath(sessionId);
    await mkdir(join(path, '..'), { recursive: true });
    // mode is best-effort (ignored on Windows); the point is the separate, human-facing path.
    await writeFile(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  private audit(checkpoint: HitlCheckpoint, event: HitlAuditEvent): void {
    checkpoint.audit.push(event);
    checkpoint.updatedAt = now();
    if (checkpoint.audit.length > 100) {
      checkpoint.audit.splice(0, checkpoint.audit.length - 100);
    }
  }

  /** Pause automation; human must complete the gate. Never auto-bypass. */
  async pause(input: PauseInput): Promise<HitlCheckpoint> {
    const existing = this.checkpoints.get(input.sessionId);
    const checkpoint: HitlCheckpoint = existing ?? {
      schemaVersion: 1,
      id: randomUUID(),
      sessionId: input.sessionId,
      status: 'running',
      reason: input.reason,
      message: input.message,
      createdAt: now(),
      updatedAt: now(),
      credentialRefs: [],
      resumeTokenHash: '',
      resumeTokenSalt: '',
      audit: [],
    };
    // A fresh token on every pause: an earlier gate's token must not open a later one.
    const resumeToken = randomUUID();
    checkpoint.resumeTokenSalt = randomBytes(16).toString('hex');
    checkpoint.resumeTokenHash = hashResumeToken(checkpoint.resumeTokenSalt, resumeToken);
    checkpoint.status = 'paused';
    checkpoint.reason = input.reason;
    checkpoint.message = input.message;
    if (input.credentialRefs?.length) {
      // Refs only — never plaintext secrets.
      checkpoint.credentialRefs = [
        ...new Set([...checkpoint.credentialRefs, ...input.credentialRefs]),
      ];
      this.audit(checkpoint, {
        at: now(),
        event: 'credential_ref',
        sessionId: checkpoint.sessionId,
        detail: `refs=${checkpoint.credentialRefs.join(',')}`,
      });
    }
    this.audit(checkpoint, {
      at: now(),
      event: 'pause',
      sessionId: checkpoint.sessionId,
      reason: input.reason,
      detail: input.message,
    });
    this.checkpoints.set(checkpoint.sessionId, checkpoint);
    await this.persist(checkpoint);
    // The raw token leaves the process here and only here, through the operator channel.
    await this.writeOperatorResumeToken(checkpoint.sessionId, resumeToken);
    return checkpoint;
  }

  /** Human finished the gate — continue the session. */
  async resume(sessionId: string, resumeToken: string): Promise<HitlCheckpoint> {
    const checkpoint = this.checkpoints.get(sessionId) ?? (await this.load(sessionId));
    if (!checkpoint) {
      throw Object.assign(new Error(`no HITL checkpoint for session ${sessionId}`), {
        code: 'E_HITL_NOT_FOUND',
      });
    }
    const provided = Buffer.from(hashResumeToken(checkpoint.resumeTokenSalt, resumeToken), 'utf8');
    const expected = Buffer.from(checkpoint.resumeTokenHash, 'utf8');
    const matchesToken = provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!matchesToken) {
      this.audit(checkpoint, {
        at: now(),
        event: 'deny',
        sessionId,
        detail: 'bad resume token',
      });
      await this.persist(checkpoint);
      throw Object.assign(new Error('HITL resume token mismatch'), { code: 'E_HITL_DENIED' });
    }
    if (checkpoint.status !== 'paused') {
      // TF-0167: a resume token is single use. Returning the checkpoint for an already
      // resumed or completed gate let a caller replay the token and skip the human step.
      this.audit(checkpoint, {
        at: now(),
        event: 'deny',
        sessionId,
        detail: `resume replay refused: gate is ${checkpoint.status}`,
      });
      await this.persist(checkpoint);
      throw Object.assign(new Error(`HITL gate is ${checkpoint.status}; it cannot be resumed again`), {
        code: 'E_HITL_DENIED',
      });
    }
    checkpoint.status = 'running';
    this.audit(checkpoint, { at: now(), event: 'resume', sessionId });
    this.checkpoints.set(sessionId, checkpoint);
    await this.persist(checkpoint);
    return checkpoint;
  }

  /**
   * Close a gate for a session that is already gone.
   *
   * Fail-open before: this read only the in-memory map, so calling it as the first operation of a
   * restarted process silently did nothing - and the method returns `undefined`, so the caller had
   * no signal either. That is precisely the case it exists for ("closing a dead session's gate for
   * bookkeeping", see AgentBrowserFacade.resumeAfterHuman), and a gate left `paused` on disk keeps
   * every later state-changing action refused. Read the persisted checkpoint like the rest of the
   * restart-aware surface (ensureLoaded / assertResumedPersisted / humanGateStatus).
   */
  async complete(sessionId: string): Promise<HitlCheckpoint | undefined> {
    const checkpoint = await this.ensureLoaded(sessionId);
    if (!checkpoint) return undefined;
    checkpoint.status = 'completed';
    checkpoint.updatedAt = now();
    await this.persist(checkpoint);
    return checkpoint;
  }

  get(sessionId: string): HitlCheckpoint | undefined {
    return this.checkpoints.get(sessionId);
  }

  /**
   * A gate outlives the process that opened it: the checkpoint is persisted, so a session this
   * process has not seen yet must be read from disk before deciding whether automation may run.
   *
   * `isPaused`/`assertResumed` stay sync and memory-only; action guards use this pair instead, so a
   * restart cannot silently drop a human gate (which would be a fail-open bypass).
   */
  async ensureLoaded(sessionId: string): Promise<HitlCheckpoint | undefined> {
    return this.checkpoints.get(sessionId) ?? (await this.load(sessionId));
  }

  /** Fail-closed assertion that also sees a gate opened by a previous process. */
  async assertResumedPersisted(sessionId: string): Promise<void> {
    const checkpoint = await this.ensureLoaded(sessionId);
    if (checkpoint?.status !== 'paused') return;
    throw Object.assign(
      new Error(
        `HITL paused (${checkpoint.reason}): ${checkpoint.message}. Human must complete the gate, then resume with token.`,
      ),
      { code: 'E_HITL_PAUSED', reason: checkpoint.reason },
    );
  }

  isPaused(sessionId: string): boolean {
    return this.checkpoints.get(sessionId)?.status === 'paused';
  }

  /** Assert automation may continue; fail-closed while paused. */
  assertResumed(sessionId: string): void {
    if (this.isPaused(sessionId)) {
      const cp = this.checkpoints.get(sessionId)!;
      throw Object.assign(
        new Error(
          `HITL paused (${cp.reason}): ${cp.message}. Human must complete the gate, then resume with token.`,
        ),
        { code: 'E_HITL_PAUSED', reason: cp.reason },
      );
    }
  }

  private async persist(checkpoint: HitlCheckpoint): Promise<void> {
    const path = this.pathFor(checkpoint.sessionId);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  private async load(sessionId: string): Promise<HitlCheckpoint | undefined> {
    try {
      const raw = await readFile(this.pathFor(sessionId), 'utf8');
      const parsed = JSON.parse(raw) as HitlCheckpoint;
      this.checkpoints.set(sessionId, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }
}

/** Human-only gates — never auto-solved. */
export const HUMAN_ONLY_GATES: readonly HitlReason[] = [
  'captcha_human_required',
  'login_wall',
  'mfa',
  'tos_review',
];

export function isHumanOnlyGate(reason: HitlReason): boolean {
  return HUMAN_ONLY_GATES.includes(reason);
}
