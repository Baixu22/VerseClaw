import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from "./fixtures/electron";
import type { ElectronApplication } from "@playwright/test";

const SESSION_KEY = "agent:main:main";

// Legacy work-mode values that used to live in workspace UI state. The client
// no longer derives or ships a per-send `workMode`/`promptMode`: the send path
// (src/stores/chat/runtime-send-actions.ts) carries none, workspaces.ts strips
// `workMode` as `_legacyWorkMode`, and prompt intensity is now resolved
// server-side from the session key. This spec guards that contract: whatever
// legacy work-mode sits in workspace state, it must NOT leak into the outgoing
// chat.sendWithMedia payload, and the documented core fields must be present.
type LegacyWorkMode = "plan" | "build" | "review" | "docsData";

type RecordedPayload = {
  sessionKey?: string;
  message?: string;
  deliver?: boolean;
  idempotencyKey?: string;
  workMode?: unknown;
  promptMode?: unknown;
  [key: string]: unknown;
};

type RecorderGlobal = {
  __cm?: { last?: RecordedPayload };
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const e = Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,val]) => JSON.stringify(k) + ":" + stableStringify(val));
  return "{" + e.join(",") + "}";
}

// FP-P1-01 added a first-send provider gate: with no usable provider the composer
// intercepts the send instead of dispatching it, so the recorder never sees a
// payload. Present a configured, keyed default account.
const PROVIDER_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const PROVIDERS = {
  [stableStringify(["providers", "accounts", null])]: [
    { id:"anthropic-e2e", vendorId:"anthropic", label:"Anthropic", authMode:"api_key", model:"claude-opus-4", enabled:true, isDefault:true, createdAt:PROVIDER_TIMESTAMP, updatedAt:PROVIDER_TIMESTAMP },
  ],
  [stableStringify(["providers", "accountKeyInfo", null])]: [
    { accountId:"anthropic-e2e", hasKey:true, keyMasked:"sk-***" },
  ],
  [stableStringify(["providers", "vendors", null])]: [],
  [stableStringify(["providers", "getDefaultAccount", null])]: { accountId:"anthropic-e2e" },
};

const WS = {
  id:"ws-1",
  name:"Demo",
  rootPath:"/tmp/d",
  agentId:"main",
  activeSessionKey:SESSION_KEY,
  permissionMode:"acceptEdits" as const,
  createdAt:1,
  updatedAt:1,
  lastOpenedAt:1,
  state:{} as Record<string, unknown>,
  sessionStates:{} as Record<string, unknown>,
};
WS.sessionStates[SESSION_KEY] = {};
const WSS = { profiles:[WS], activeWorkspaceId:WS.id, activeWorkspace:WS };

async function installRecorder(app: ElectronApplication) {
  await app.evaluate(async function() {
    const mainModule = process.mainModule;
    if (!mainModule) throw new Error("Expected Electron main module");
    const ipc = mainModule.require("electron");
    const h = ipc.ipcMain._invokeHandlers;
    const prev = h.get("host:invoke");
    if (!prev) return;
    (globalThis as typeof globalThis & RecorderGlobal).__cm = {};

    ipc.ipcMain.removeHandler("host:invoke");
    ipc.ipcMain.handle("host:invoke", async function(ev: unknown, req: {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    }) {
      const m = req.module, a = req.action, p = req.payload;
      const recorder = (globalThis as typeof globalThis & RecorderGlobal).__cm;

      if (m === "chat" && a === "sendWithMedia") {
        // Record the real outgoing payload verbatim (no fabrication).
        if (recorder) recorder.last = Object.assign({}, p);
        return {id:req.id, ok:true, data:{success:true, result:{runId:"r"}}};
      }
      return prev(ev, req);
    });
  });
}

function mkMocks() {
  const k = (m: string, p?: unknown) => stableStringify([m, p ?? null]);
  const ok = (d: unknown) => ({ ok:true, data:d });
  const js = (j: unknown) => ({ status:200, ok:true, json:j });
  return {
    gatewayStatus: { state:"running", port:18789, pid:12345 },
    gatewayRpc: {
      [k("sessions.list", {})]: { success:true, result:{sessions:[{key:SESSION_KEY, displayName:"main"}]} },
      [k("chat.history", {sessionKey:SESSION_KEY, limit:200, maxChars:500000})]: { success:true, result:{messages:[]} },
    },
    hostApi: {
      ...PROVIDERS,
      [k("/api/gateway/status","GET")]: ok(js({state:"running",port:18789,pid:12345})),
      [k("/api/settings","GET")]: ok(js({language:"en",setupComplete:true})),
      [k("/api/agents","GET")]: ok(js({success:true,agents:[{id:"main",name:"main"}]})),
      [k("workspaces","list")]: WSS,
      [k("workspaces","getActive")]: WS,
      [k("/api/skills/quick-access","POST")]: ok(js({success:true,skills:[]})),
    },
  };
}

async function sendAndRecord(app: ElectronApplication, message: string): Promise<RecordedPayload> {
  await installIpcMocks(app, mkMocks());
  await installRecorder(app);
  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout:30000 });
  await page.getByTestId("chat-composer-input").click();
  await page.getByTestId("chat-composer-input").fill(message);
  await page.getByTestId("chat-composer-send").click();
  await expect
    .poll(async () => await app.evaluate(() => Boolean((globalThis as typeof globalThis & RecorderGlobal).__cm?.last)), { timeout:15000 })
    .toBe(true);
  const payload = await app.evaluate(() => (globalThis as typeof globalThis & RecorderGlobal).__cm?.last);
  if (!payload) throw new Error("Expected recorded chat payload");
  return payload;
}

test.describe("Chat send payload contract (work-mode intensity retired client-side)", () => {
  for (const mode of ["plan","build","review","docsData"] as const satisfies readonly LegacyWorkMode[]) {
    test("legacy workMode '" + mode + "' in workspace state does not leak into the send payload", async ({ launchElectronApp }) => {
      const app = await launchElectronApp({ skipSetup:true });
      try {
        // IPC mocks are serialized into the Main process, so set the workspace
        // state before installing them. Seed the legacy work mode the retired
        // feature used to persist.
        WS.state = { workMode: mode };
        const payload = await sendAndRecord(app, "Test msg");

        // Documented core fields the client still sends.
        expect(payload.sessionKey).toBe(SESSION_KEY);
        expect(payload.message).toBe("Test msg");
        expect(payload.deliver).toBe(false);
        expect(typeof payload.idempotencyKey).toBe("string");

        // The retired client-side intensity fields must be absent regardless of
        // the legacy work mode sitting in workspace state.
        expect(payload.workMode).toBeUndefined();
        expect(payload.promptMode).toBeUndefined();
      } finally { await closeElectronApp(app); }
    });
  }

  test("send payload carries no workMode/promptMode when workspace state is empty", async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup:true });
    try {
      WS.state = {};
      const payload = await sendAndRecord(app, "Hello");
      expect(payload.sessionKey).toBe(SESSION_KEY);
      expect(payload.message).toBe("Hello");
      expect(payload.deliver).toBe(false);
      expect(payload.workMode).toBeUndefined();
      expect(payload.promptMode).toBeUndefined();
    } finally { await closeElectronApp(app); }
  });
});
