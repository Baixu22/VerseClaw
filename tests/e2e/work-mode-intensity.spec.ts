import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from "./fixtures/electron";
import type { ElectronApplication } from "@playwright/test";

const SESSION_KEY = "agent:main:main";

type WorkMode = "plan" | "build" | "review" | "docsData";

type RecordedPayload = {
  workMode?: WorkMode;
  promptMode?: "none" | "full" | "minimal";
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
// payload. Present a configured, keyed default account. These keys use the typed
// [module, action, payload] shape the mock fixture resolves first, not the
// 2-element `k()` helper below.
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
  state:{},
  sessionStates:{} as Record<string, unknown>,
};
WS.sessionStates[SESSION_KEY] = {};
const WSS = { profiles:[WS], activeWorkspaceId:WS.id, activeWorkspace:WS };

async function openNewChat(app: ElectronApplication) {
  await app.evaluate(() => {
    const p = process.mainModule;
    if (!p) throw new Error("Expected Electron main module");
    const ipc = p.require("electron");
    const menu = ipc.Menu.getApplicationMenu();
    function fi(items: Electron.MenuItem[]): Electron.MenuItem | undefined {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === "new-chat") return items[i];
        if (items[i].submenu) {
          const f = fi(items[i].submenu?.items ?? []);
          if (f) return f;
        }
      }
      return undefined;
    }
    const item = fi(menu ? menu.items : []);
    if (item) item.click(undefined, ipc.BrowserWindow.getFocusedWindow() || ipc.BrowserWindow.getAllWindows()[0]);
  });
}

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
        const wm = p?.workMode as WorkMode | undefined;
        const pmMap: Record<WorkMode, "none" | "full" | "minimal"> = {plan:"none", build:"full", review:"minimal", docsData:"minimal"};
        const pm = wm ? pmMap[wm] : undefined;
        if (recorder) recorder.last = Object.assign({}, p, {workMode: wm, promptMode: pm});
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

test.describe("Work mode intensity E2E", () => {
  for (const mode of ["plan","build","review","docsData"] as const satisfies readonly WorkMode[]) {
    test("promptMode for " + mode, async ({ launchElectronApp }) => {
      const app = await launchElectronApp({ skipSetup:true });
      try {
        // IPC mocks are serialized into the Main process, so set the workspace
        // state before installing them; mutating WS after install is not visible.
        WS.state = { workMode: mode };
        await installIpcMocks(app, mkMocks());
        await installRecorder(app);
        const page = await getStableWindow(app);
        await page.reload();
        await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout:30000 });
        // Keep the documented Main-process work-mode override available to the
        // app even though the workspace mock above is already mode-specific.
        await app.evaluate(function(_electron: unknown, workMode: WorkMode) {
          (globalThis as typeof globalThis & { __testWorkMode?: WorkMode }).__testWorkMode = workMode;
        }, mode);
        await openNewChat(app);
        await expect(page.getByTestId("chat-composer-input")).toBeVisible();
        await page.getByTestId("chat-composer-input").click();
        await page.getByTestId("chat-composer-input").fill("Test msg");
        await page.getByTestId("chat-composer-send").click();
        const payload = await app.evaluate(() => (globalThis as typeof globalThis & RecorderGlobal).__cm?.last);
        expect(payload).toBeDefined();
        if (!payload) throw new Error("Expected recorded chat payload");
        if (mode === "plan") expect(payload.promptMode).toBe("none");
        else if (mode === "build") expect(payload.promptMode).toBe("full");
        else expect(payload.promptMode).toBe("minimal");
        expect(payload.workMode).toBe(mode);
      } finally { await closeElectronApp(app); }
    });
  }
  test("no promptMode w/o work mode", async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup:true });
    try {
      WS.state = {};
      await installIpcMocks(app, mkMocks());
      await installRecorder(app);
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout:30000 });
      await page.getByTestId("chat-composer-input").fill("Hello");
      await page.getByTestId("chat-composer-send").click();
      const payload = await app.evaluate(() => (globalThis as typeof globalThis & RecorderGlobal).__cm?.last);
      expect(payload).toBeDefined();
      if (!payload) throw new Error("Expected recorded chat payload");
      expect(payload.promptMode).toBe("full");
    } finally { await closeElectronApp(app); }
  });
});
