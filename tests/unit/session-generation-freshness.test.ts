// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/runtime-snapshot';
import { clearSessionStoreCaches } from '../../openclaw_runtime/src/config/sessions/store-cache';
import * as freshness from '../../openclaw_runtime/src/config/sessions/store-freshness';
import { replaceSqliteSessionStore } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { loadSessionEntry } from '../../openclaw_runtime/src/gateway/session-utils';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

let stateDir: string;
let storePath: string;
const sessionKey = 'agent:main:continuation';

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'session-generation-'));
  storePath = join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
  mkdirSync(join(stateDir, 'agents', 'main', 'sessions'), { recursive: true });
  vi.stubEnv('OPENCLAW_STATE_DIR', stateDir);
  vi.stubEnv('OPENCLAW_SESSION_CACHE_TTL_MS', '60000');
  clearSessionStoreCaches();
  // Keep the filesystem observation unchanged while SQLite commits a new row.
  vi.spyOn(freshness, 'getSessionStoreFreshnessSnapshot').mockReturnValue({ mtimeMs: 1, sizeBytes: 4096 });
});

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
  clearSessionStoreCaches();
  clearRuntimeConfigSnapshot();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

describe('generation reads across a session-store cache collision', () => {
  it.each([false, true])('reads the persisted generation with skipCache (deleted main agent: %s)', (deletedMain) => {
    setRuntimeConfigSnapshot({
      agents: { list: [{ id: deletedMain ? 'replacement' : 'main', default: true }] },
      session: { store: join(stateDir, 'agents', '{agentId}', 'sessions', 'sessions.json') },
    });
    replaceSqliteSessionStore(storePath, { [sessionKey]: { sessionId: 'generation-before', updatedAt: 1 } });
    expect(loadSessionEntry(sessionKey).entry?.sessionId).toBe('generation-before');

    replaceSqliteSessionStore(storePath, { [sessionKey]: { sessionId: 'generation-after', updatedAt: 2 } });
    expect(loadSessionEntry(sessionKey).entry?.sessionId).toBe('generation-before');
    expect(loadSessionEntry(sessionKey, { skipCache: true }).entry?.sessionId).toBe('generation-after');
  });
});
