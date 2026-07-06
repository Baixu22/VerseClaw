/**
 * Resource Tracker Tests
 *
 * Tests the resource tracking pipeline:
 * - Registration + listing
 * - TCP heartbeat detection
 * - Stop/stopAll APIs
 * - Session-scoped unregistration
 * - Port scanning
 * - Idle detection counts
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { findFreePort } from '../helpers/find-free-port';
import type { ResourceTracker } from '../../electron/services/resource-tracker';
import type { TrackedResource } from '../../shared/types/resource-tracker';

type ResourceTrackerInternals = {
  tcpPing(port: number): Promise<boolean>;
  probeResource(resource: TrackedResource): Promise<void>;
  autoCleanup(): Promise<void>;
};

function internals(tracker: ResourceTracker): ResourceTracker & ResourceTrackerInternals {
  return tracker as ResourceTracker & ResourceTrackerInternals;
}

describe('ResourceTracker', () => {
  let tracker: ResourceTracker;

  beforeEach(async () => {
    // Reset the singleton to get a fresh state
    vi.resetModules();
    const freshModule = await import('../../electron/services/resource-tracker');
    tracker = freshModule.getResourceTracker();
    // Ensure no resources from prior tests
    tracker.stop();
    tracker.start();
  });

  afterEach(() => {
    tracker.stop();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  async function startServer(label?: string): Promise<{ port: number; server: Server }> {
    const port = await findFreePort();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`hello from ${label ?? port}`);
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { port, server };
  }

  async function stopServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }

  // ── Registration ─────────────────────────────────────────────────────

  describe('registration', () => {
    it('registers a resource and sets correct fields', () => {
      const id = tracker.register({
        port: 19999,
        pid: 12345,
        label: 'Test Server',
        sessionKey: 'session-1',
        sessionLabel: 'Test Session',
      });

      const snap = tracker.getSnapshot();
      expect(snap.resources).toHaveLength(1);
      expect(snap.resources[0].port).toBe(19999);
      expect(snap.resources[0].pid).toBe(12345);
      expect(snap.resources[0].label).toBe('Test Server');
      expect(snap.resources[0].sessionKey).toBe('session-1');
      expect(snap.resources[0].id).toBe(id);
    });

    it('generates unique IDs for each resource', () => {
      const id1 = tracker.register({ port: 10001, pid: 1, sessionKey: 's1' });
      const id2 = tracker.register({ port: 10002, pid: 2, sessionKey: 's2' });
      expect(id1).not.toBe(id2);
    });
  });

  // ── List API ─────────────────────────────────────────────────────────

  describe('list API', () => {
    it('returns empty when no resources', () => {
      const result = tracker.list();
      expect(result.success).toBe(true);
      expect(result.resources).toHaveLength(0);
    });

    it('returns correct counts', () => {
      tracker.register({ port: 20001, pid: 1, sessionKey: 'x' });
      tracker.register({ port: 20002, pid: 2, sessionKey: 'y' });
      const result = tracker.list();
      expect(result.success).toBe(true);
      expect(result.resources).toHaveLength(2);
      expect(result.healthyCount).toBe(2);
      expect(result.idleTimeoutMinutes).toBeGreaterThan(0);
    });
  });

  // ── Heartbeat / TCP ping ─────────────────────────────────────────────

  describe('heartbeat', () => {
    it('TCP-pings a live port and returns true', async () => {
      const { port, server } = await startServer('ping-live');
      try {
        const alive = await internals(tracker).tcpPing(port);
        expect(alive).toBe(true);
      } finally {
        await stopServer(server);
      }
    });

    it('TCP-pings a dead port and returns false', async () => {
      const freePort = await findFreePort();
      const dead = await internals(tracker).tcpPing(freePort);
      expect(dead).toBe(false);
    });

    it('marks newly registered resources as healthy', () => {
      tracker.register({ port: 21000, pid: 99999, sessionKey: 'hb' });
      const snap = tracker.getSnapshot();
      expect(snap.resources[0].status).toBe('healthy');
    });

    it('marks reachable resources idle when the owning session has been inactive', async () => {
      const { port, server } = await startServer('idle-server');
      try {
        const id = tracker.register({ port, pid: 99999, sessionKey: 'idle-session' });
        const resource = tracker.getSnapshot().resources.find((entry) => entry.id === id)!;
        resource.sessionLastActiveAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();

        await internals(tracker).probeResource(resource);

        const updated = tracker.getSnapshot().resources.find((entry) => entry.id === id)!;
        expect(updated.status).toBe('idle');
        expect(tracker.getSnapshot().idleCount).toBe(1);
      } finally {
        await stopServer(server);
      }
    });
  });

  // ── Stop ─────────────────────────────────────────────────────────────

  describe('stopResource', () => {
    it('returns error for non-existent resource', async () => {
      const result = await tracker.stopResource('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('removes resource when port is no longer reachable', async () => {
      const { port, server } = await startServer('stop-me');
      const id = tracker.register({
        port, pid: process.pid, sessionKey: 'stop-session', label: 'Stop Test',
      });

      // Stop the server so the TCP fallback works
      await stopServer(server);

      // killProcess refuses the current process, but TCP fallback detects the dead port.
      const result = await tracker.stopResource(id);
      expect(result.success).toBe(true);
    });
  });

  describe('stopAll', () => {
    it('processes all resources without crashing', async () => {
      const s1 = await startServer('all-1');
      const s2 = await startServer('all-2');
      try {
        tracker.register({ port: s1.port, pid: process.pid, sessionKey: 's1', label: 'A' });
        tracker.register({ port: s2.port, pid: process.pid, sessionKey: 's2', label: 'B' });
      } finally {
        await stopServer(s1.server);
        await stopServer(s2.server);
      }

      const result = await tracker.stopAll();
      expect(result).toBeDefined();
      expect(typeof result.stoppedCount).toBe('number');
    });
  });

  // ── Session unregistration ───────────────────────────────────────────

  describe('unregisterBySession', () => {
    it('removes all resources for a given session key', async () => {
      const { port: p1, server: s1 } = await startServer('session-a');
      const { port: p2, server: s2 } = await startServer('session-b');

      tracker.register({ port: p1, pid: process.pid, sessionKey: 'session-a', label: 'A' });
      tracker.register({ port: p2, pid: process.pid, sessionKey: 'session-b', label: 'B' });

      await stopServer(s1);
      await tracker.unregisterBySession('session-a');

      const remaining = tracker.getSnapshot().resources;
      const aRemaining = remaining.filter((r) => r.sessionKey === 'session-a');
      expect(aRemaining).toHaveLength(0);

      await stopServer(s2);
    });
  });

  describe('port discovery', () => {
    it('registers newly discovered listening ports for a session', async () => {
      vi.spyOn(tracker, 'scanListeningPorts').mockResolvedValue([
        { port: 4100, pid: 100, address: '127.0.0.1:4100' },
        { port: 4200, pid: 200, address: '127.0.0.1:4200' },
      ]);

      const ids = await tracker.registerNewListeningPortsSince({
        before: [{ port: 4100, pid: 100, address: '127.0.0.1:4100' }],
        sessionKey: 'agent:main:main',
        sessionLabel: 'main',
        workspaceId: 'workspace-a',
        agentId: 'main',
        labelPrefix: 'Test server',
      });

      expect(ids).toHaveLength(1);
      const resource = tracker.getSnapshot().resources[0];
      expect(resource.port).toBe(4200);
      expect(resource.pid).toBe(200);
      expect(resource.sessionKey).toBe('agent:main:main');
      expect(resource.workspaceId).toBe('workspace-a');
    });

    it('does not register ports owned by the current Electron process', async () => {
      vi.spyOn(tracker, 'scanListeningPorts').mockResolvedValue([
        { port: 4300, pid: process.pid, address: '127.0.0.1:4300' },
      ]);

      const ids = await tracker.registerNewListeningPortsSince({
        before: [],
        sessionKey: 'agent:main:main',
      });

      expect(ids).toHaveLength(0);
      expect(tracker.getSnapshot().resources).toHaveLength(0);
    });
  });

  // ── Port scanning ────────────────────────────────────────────────────

  describe('scanListeningPorts', () => {
    it('finds a known listening port', async () => {
      const { port, server } = await startServer('scan-me');
      try {
        const ports = await tracker.scanListeningPorts();
        const found = ports.find((p) => p.port === port);
        expect(found).toBeDefined();
        expect(found!.port).toBe(port);
        expect(found!.pid).toBeGreaterThan(0);
      } finally {
        await stopServer(server);
      }
    });
  });

  // ── Counts ───────────────────────────────────────────────────────────

  describe('snapshot counts', () => {
    it('tracks healthyCount correctly', () => {
      tracker.register({ port: 30001, pid: 1, sessionKey: 'x' });
      tracker.register({ port: 30002, pid: 2, sessionKey: 'y' });
      const snap = tracker.getSnapshot();
      expect(snap.healthyCount).toBe(2);
      expect(snap.idleCount).toBe(0);
      expect(snap.unreachableCount).toBe(0);
    });

    it('auto-cleans stale idle resources', async () => {
      const freePort = await findFreePort();
      const id = tracker.register({ port: freePort, pid: process.pid, sessionKey: 'old-session' });
      const resource = tracker.getSnapshot().resources.find((entry) => entry.id === id)!;
      resource.status = 'idle';
      resource.sessionLastActiveAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

      await internals(tracker).autoCleanup();

      expect(tracker.getSnapshot().resources).toHaveLength(0);
    });
  });
});
