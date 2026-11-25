/**
 * Resource Tracker Service
 *
 * Tracks server/port resources spawned during agent sessions, exposes them to
 * the renderer, checks reachability, and cleans up stale resources.
 */

import { randomUUID } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { exec } from '../utils/counted-child-process';
import { promisify } from 'node:util';
import {
  type ResourceOwnership,
  type TrackedResource,
  type ResourceTrackerSnapshot,
  type ResourceTrackerRegisterPayload,
} from '../../shared/types/resource-tracker';
import { logger } from '../utils/logger';
import { getTimerAligner } from '../../shared/resources';

const execAsync = promisify(exec);

/** How often to scan all tracked resources with TCP heartbeat (ms). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** A resource is marked idle after this many ms without session activity. */
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

/** A resource is auto-cleaned after this many ms without session activity. */
const AUTO_CLEANUP_IDLE_MS = 30 * 60 * 1000;

/** TCP connect timeout per heartbeat probe (ms). */
const PROBE_TIMEOUT_MS = 3_000;
const HEARTBEAT_PROBE_CONCURRENCY = 4;
const MAX_HEARTBEAT_CLEANUPS = 8;

type ResourceRecord = TrackedResource;
type ListeningPort = { port: number; pid: number; address: string };

type RegisterNewPortsPayload = {
  before: ListeningPort[] | Set<string>;
  sessionKey: string;
  sessionLabel?: string;
  workspaceId?: string | null;
  agentId?: string | null;
  labelPrefix?: string;
  command?: string;
  ownership?: ResourceOwnership;
};

type WatchNewPortsPayload = RegisterNewPortsPayload & {
  delaysMs?: number[];
};

function portKey(entry: Pick<ListeningPort, 'port' | 'pid'>): string {
  return `${entry.pid}:${entry.port}`;
}

function beforeKeys(before: ListeningPort[] | Set<string>): Set<string> {
  if (before instanceof Set) return new Set(before);
  return new Set(before.map(portKey));
}

export class ResourceTracker {
  private resources = new Map<string, ResourceRecord>();
  private heartbeatUnregister: (() => void) | null = null;
  private discoveryTimers = new Set<ReturnType<typeof setTimeout>>();
  private heartbeatInFlight = false;
  private cleanupCursor = 0;

  start(): void {
    if (this.heartbeatUnregister) return;
    this.heartbeatUnregister = getTimerAligner().register({
      id: 'resource-tracker-heartbeat',
      intervalMs: HEARTBEAT_INTERVAL_MS,
      priority: 'interactive',
      run: () => this.runHeartbeat(),
    });
    logger.info('[ResourceTracker] Started heartbeat interval');
  }

  stop(): void {
    if (this.heartbeatUnregister) {
      this.heartbeatUnregister();
      this.heartbeatUnregister = null;
    }
    for (const timer of this.discoveryTimers) clearTimeout(timer);
    this.discoveryTimers.clear();
    logger.info('[ResourceTracker] Stopped');
  }

  /** Shutdown: stop all tracked resources. */
  async shutdown(): Promise<void> {
    this.stop();
    const ids = Array.from(this.resources.keys());
    for (const id of ids) {
      await this.stopResource(id).catch(() => {});
    }
    logger.info('[ResourceTracker] Shutdown complete');
  }

  register(payload: ResourceTrackerRegisterPayload): string {
    const existing = Array.from(this.resources.values()).find((resource) => (
      resource.port === payload.port && resource.pid === payload.pid
    ));
    if (existing) {
      existing.sessionKey = payload.sessionKey;
      existing.sessionLabel = payload.sessionLabel ?? existing.sessionLabel;
      existing.workspaceId = payload.workspaceId ?? existing.workspaceId ?? null;
      existing.agentId = payload.agentId ?? existing.agentId ?? null;
      existing.command = payload.command ?? existing.command;
      existing.ownership = existing.ownership === 'managed' ? 'managed' : (payload.ownership ?? 'observed');
      existing.sessionLastActiveAt = new Date().toISOString();
      return existing.id;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const record: ResourceRecord = {
      id,
      port: payload.port,
      label: payload.label ?? `Process on :${payload.port}`,
      pid: payload.pid,
      command: payload.command,
      sessionKey: payload.sessionKey,
      sessionLabel: payload.sessionLabel,
      workspaceId: payload.workspaceId ?? null,
      agentId: payload.agentId ?? null,
      status: 'healthy',
      ownership: payload.ownership ?? 'managed',
      startedAt: now,
      lastHeartbeatAt: now,
      sessionLastActiveAt: now,
    };
    this.resources.set(id, record);
    logger.info(`[ResourceTracker] Registered: ${record.label} (pid=${record.pid}, port=${record.port}, session=${record.sessionKey})`);
    return id;
  }

  markSessionActive(sessionKey: string): void {
    const now = new Date().toISOString();
    for (const resource of this.resources.values()) {
      if (resource.sessionKey === sessionKey) {
        resource.sessionLastActiveAt = now;
      }
    }
  }

  async registerNewListeningPortsSince(payload: RegisterNewPortsPayload): Promise<string[]> {
    const baseline = beforeKeys(payload.before);
    const discovered = await this.scanListeningPorts();
    const registeredIds: string[] = [];

    for (const entry of discovered) {
      if (entry.pid === process.pid) continue;
      if (baseline.has(portKey(entry))) continue;
      if (Array.from(this.resources.values()).some((resource) => (
        resource.port === entry.port && resource.pid === entry.pid
      ))) {
        continue;
      }

      registeredIds.push(this.register({
        port: entry.port,
        pid: entry.pid,
        label: `${payload.labelPrefix ?? 'Session server'} :${entry.port}`,
        command: payload.command,
        sessionKey: payload.sessionKey,
        sessionLabel: payload.sessionLabel,
        workspaceId: payload.workspaceId ?? null,
        agentId: payload.agentId ?? null,
        ownership: payload.ownership ?? 'observed',
      }));
    }

    return registeredIds;
  }

  watchNewListeningPorts(payload: WatchNewPortsPayload): void {
    const baseline = beforeKeys(payload.before);
    const delaysMs = payload.delaysMs ?? [1_000, 5_000, 15_000, 30_000];

    for (const delayMs of delaysMs) {
      const timer = setTimeout(() => {
        this.discoveryTimers.delete(timer);
        void this.registerNewListeningPortsSince({ ...payload, before: baseline }).catch((error) => {
          logger.warn(`[ResourceTracker] Port discovery failed: ${String(error)}`);
        });
      }, delayMs);
      timer.unref?.();
      this.discoveryTimers.add(timer);
    }
  }

  /**
   * Unregister resources by session key, for example when the owning session is deleted.
   * This attempts to stop each resource before removing it from the tracker.
   */
  async unregisterBySession(sessionKey: string): Promise<number> {
    const toRemove: string[] = [];
    for (const [id, resource] of this.resources) {
      if (resource.sessionKey === sessionKey) {
        toRemove.push(id);
      }
    }

    let removed = 0;
    for (const id of toRemove) {
      const result = await this.stopResource(id).catch((error) => ({
        success: false,
        error: String(error),
      }));
      if (result.success) {
        removed += 1;
      }
    }

    if (removed > 0) {
      logger.info(`[ResourceTracker] Unregistered ${removed} resources for session ${sessionKey}`);
    }
    return removed;
  }

  private async runHeartbeat(): Promise<void> {
    if (this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      // Reclamation must progress during shedding. Bound the probes instead of
      // putting maintenance behind the gate for new background work.
      const entries = Array.from(this.resources.values());
      for (let offset = 0; offset < entries.length; offset += HEARTBEAT_PROBE_CONCURRENCY) {
        await Promise.allSettled(entries.slice(offset, offset + HEARTBEAT_PROBE_CONCURRENCY)
          .map(resource => this.probeResource(resource)));
      }
      await this.autoCleanup();
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async probeResource(record: ResourceRecord): Promise<void> {
    const reachable = await this.tcpPing(record.port);
    const existing = this.resources.get(record.id);
    if (!existing) return;

    const now = new Date().toISOString();
    if (reachable) {
      const lastActivityAt = new Date(
        existing.sessionLastActiveAt ?? existing.lastHeartbeatAt ?? existing.startedAt,
      ).getTime();
      const idleFor = Date.now() - lastActivityAt;
      existing.lastHeartbeatAt = now;
      existing.status = idleFor > IDLE_THRESHOLD_MS ? 'idle' : 'healthy';
    } else {
      existing.status = 'unreachable';
    }
  }

  private tcpPing(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket: Socket = netConnect({ port, host: '127.0.0.1', timeout: PROBE_TIMEOUT_MS });
      let settled = false;

      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          // Ignore close failures.
        }
        resolve(ok);
      };

      socket.on('connect', () => done(true));
      socket.on('error', () => done(false));
      socket.on('timeout', () => {
        socket.destroy();
        done(false);
      });
    });
  }

  private async autoCleanup(): Promise<void> {
    const now = Date.now();
    const eligible = [...this.resources.values()].filter(resource => this.canAutoCleanup(resource, now));
    if (eligible.length === 0) { this.cleanupCursor = 0; return; }
    const start = this.cleanupCursor % eligible.length;
    const count = Math.min(eligible.length, MAX_HEARTBEAT_CLEANUPS);
    const candidates = Array.from({ length: count }, (_, offset) => eligible[(start + offset) % eligible.length].id);
    this.cleanupCursor = (start + count) % eligible.length;
    let cleaned = 0;
    for (const id of candidates) {
      const resource = this.resources.get(id);
      if (resource && this.canAutoCleanup(resource, Date.now())) {
        logger.info(`[ResourceTracker] Auto-cleaning ${resource.status} resource: ${resource.label} (port=${resource.port})`);
        const result = await this.stopResource(id).catch(() => ({ success: false }));
        if (result.success) cleaned += 1;
      }
    }

    if (cleaned > 0) {
      logger.info(`[ResourceTracker] Auto-cleaned ${cleaned} resources`);
    }
  }

  private canAutoCleanup(resource: ResourceRecord, now: number): boolean {
    if (resource.ownership !== 'managed') return false;
    if (resource.status === 'unreachable')
      return now - new Date(resource.lastHeartbeatAt ?? resource.startedAt).getTime() > 5 * 60 * 1000;
    return resource.status === 'idle'
      && now - new Date(resource.sessionLastActiveAt ?? resource.startedAt).getTime() > AUTO_CLEANUP_IDLE_MS;
  }

  getSnapshot(): ResourceTrackerSnapshot {
    const resources = Array.from(this.resources.values());
    const healthyCount = resources.filter((resource) => resource.status === 'healthy').length;
    const idleCount = resources.filter((resource) => resource.status === 'idle').length;
    const unreachableCount = resources.filter((resource) => resource.status === 'unreachable').length;

    return {
      resources,
      healthyCount,
      idleCount,
      unreachableCount,
      idleTimeoutMinutes: Math.round(IDLE_THRESHOLD_MS / 60_000),
    };
  }

  list() {
    return { success: true, ...this.getSnapshot() };
  }

  async stopResource(resourceId: string): Promise<{ success: boolean; error?: string; resourceId?: string }> {
    const record = this.resources.get(resourceId);
    if (!record) {
      return { success: false, error: 'Resource not found' };
    }
    if (record.ownership !== 'managed') {
      return { success: false, error: 'Observed resource is not owned by this session', resourceId };
    }

    try {
      await this.killProcess(record.pid);
      this.resources.delete(resourceId);
      logger.info(`[ResourceTracker] Stopped: ${record.label} (pid=${record.pid})`);
      return { success: true, resourceId };
    } catch (error) {
      const reachable = await this.tcpPing(record.port);
      if (!reachable) {
        this.resources.delete(resourceId);
        return { success: true, resourceId };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        resourceId,
      };
    }
  }

  async stopAll(): Promise<{ success: boolean; error?: string; stoppedCount: number }> {
    const ids = Array.from(this.resources.keys());
    let stoppedCount = 0;

    for (const id of ids) {
      const result = await this.stopResource(id);
      if (result.success) stoppedCount += 1;
    }

    logger.info(`[ResourceTracker] Stopped ${stoppedCount} resources`);
    return { success: true, stoppedCount };
  }

  private async killProcess(pid: number): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      throw new Error('Refusing to stop an invalid or current process id');
    }

    if (process.platform === 'win32') {
      await execAsync(`taskkill /F /PID ${pid} /T`, { timeout: 5000, windowsHide: true });
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already gone.
        }
      }
    }
  }

  /**
   * Scan all listening TCP ports and return { port, pid } pairs.
   * Used by the registration path to discover what agents have started.
   */
  async scanListeningPorts(): Promise<ListeningPort[]> {
    const result: ListeningPort[] = [];

    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync('netstat -ano', { timeout: 5000, windowsHide: true });
        for (const line of stdout.split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5 && parts[3] === 'LISTENING') {
            const addressPart = parts[1];
            const pid = parseInt(parts[4], 10);
            if (Number.isNaN(pid)) continue;
            const match = addressPart.match(/:(\d+)$/);
            if (match) {
              const port = parseInt(match[1], 10);
              if (port > 0 && port < 65536) {
                result.push({ port, pid, address: addressPart });
              }
            }
          }
        }
      } else {
        const { stdout } = await execAsync("lsof -i -P -n -sTCP:LISTEN 2>/dev/null || ss -tlnp 2>/dev/null", { timeout: 5000 });
        for (const line of stdout.split(/\r?\n/)) {
          const pidMatch = line.match(/[^\d](\d+)$/);
          const portMatch = line.match(/:(\d+)\s/);
          if (pidMatch && portMatch) {
            const pid = parseInt(pidMatch[1], 10);
            const port = parseInt(portMatch[1], 10);
            if (port > 0 && port < 65536 && pid > 0) {
              result.push({ port, pid, address: `127.0.0.1:${port}` });
            }
          }
        }
      }
    } catch {
      // Port scanning is opportunistic.
    }

    return result;
  }
}

let instance: ResourceTracker | null = null;

export function getResourceTracker(): ResourceTracker {
  if (!instance) {
    instance = new ResourceTracker();
  }
  return instance;
}
