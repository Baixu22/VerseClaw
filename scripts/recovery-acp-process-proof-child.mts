import fs from "node:fs";
import path from "node:path";
import type { AcpRuntime } from "../openclaw_runtime/packages/acp-core/src/runtime/types.js";
import { AcpSessionManager } from "../openclaw_runtime/src/acp/control-plane/manager.core.js";
import { DEFAULT_DEPS } from "../openclaw_runtime/src/acp/control-plane/manager.types.js";
import { upsertAcpSessionMeta } from "../openclaw_runtime/src/acp/runtime/session-meta.js";
import { updateSessionStoreAtomic } from "../openclaw_runtime/src/config/sessions/store.js";
import {
  openOpenClawStateDatabase,
  closeOpenClawStateDatabase,
} from "../openclaw_runtime/src/state/openclaw-state-db.js";
import { closeOpenClawAgentDatabasesForTest } from "../openclaw_runtime/src/state/openclaw-agent-db.js";

const root = process.argv[2];
const mode = process.argv[3];
const key = "agent:main:acp-process-proof";
const cfg = {
  session: { store: path.join(root, "agents", "main", "sessions", "sessions.json") },
  acp: { enabled: true, backend: "fixture" },
};
const handle = {
  sessionKey: key,
  backend: "fixture",
  runtimeSessionName: key,
  backendSessionId: "native-backend",
  agentSessionId: "native-agent",
  acpxRecordId: "native-record",
};
const checkpoint = (type: string) => {
  const { db, path: databasePath } = openOpenClawStateDatabase();
  const row = db.prepare("SELECT * FROM acp_sessions WHERE session_key = ?").get(key);
  process.stdout.write(JSON.stringify({ type, pid: process.pid, databasePath, row }) + "\n");
};
const hold = () =>
  new Promise<void>(() => {
    setInterval(() => {}, 1000);
  });
try {
  if (mode === "seed") {
    await updateSessionStoreAtomic(cfg.session.store, (store) => {
      store[key] = { sessionId: "native-acp-session", updatedAt: 1 };
    });
    await upsertAcpSessionMeta({
      cfg,
      sessionKey: key,
      mutate: () => ({
        backend: "fixture",
        agent: "main",
        runtimeSessionName: key,
        mode: "persistent",
        state: "idle",
        lastActivityAt: 1,
        identity: {
          state: "resolved",
          source: "ensure",
          lastUpdatedAt: 1,
          acpxRecordId: "native-record",
          acpxSessionId: "native-backend",
          agentSessionId: "native-agent",
        },
      }),
    });
    checkpoint("seeded");
  } else {
    const runtime = {
      ensureSession: async () => {
        if (mode === "before-turn") {
          checkpoint("admitted-before-turn");
          await hold();
        }
        return handle;
      },
      runTurn: async function* () {
        const effectFile = path.join(root, "effects.jsonl");
        const fd = fs.openSync(effectFile, "a");
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, requestId: "native-original" }) + "\n");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        if (mode === "after-effect") {
          checkpoint("effect-before-terminal");
          await hold();
        }
        yield { type: "done" as const };
      },
      close: async () => {},
      prepareFreshSession: async () => {},
    } as unknown as AcpRuntime;
    const backend = { id: "fixture", runtime };
    const manager = new AcpSessionManager({
      ...DEFAULT_DEPS,
      requireRuntimeBackend: () => backend,
      getRuntimeBackend: () => backend,
    });
    try {
      await manager.runTurn({
        cfg,
        sessionKey: key,
        requestId: "native-original",
        text: "native effect",
        mode: "prompt",
      });
      checkpoint("completed");
    } catch (error) {
      checkpoint("refused");
      process.stdout.write(JSON.stringify({ type: "error", error: String(error) }) + "\n");
    }
  }
} finally {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
}
