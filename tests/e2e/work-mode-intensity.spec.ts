import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from "./fixtures/electron";

const SESSION_KEY = "agent:main:main";

function stableStringify(v) {
  if (v == null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const e = Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,val]) => JSON.stringify(k) + ":" + stableStringify(val));
  return "{" + e.join(",") + "}";
}

const WS = { id:"ws-1", name:"Demo", rootPath:"/tmp/d", agentId:"main", activeSessionKey:SESSION_KEY, permissionMode:"acceptEdits", createdAt:1, updatedAt:1, lastOpenedAt:1, state:{}, sessionStates:{} };
WS.sessionStates[SESSION_KEY] = {};
const WSS = { profiles:[WS], activeWorkspaceId:WS.id, activeWorkspace:WS };

async function openNewChat(app) {
  await app.evaluate(() => {
    const p = process.mainModule;
    const ipc = p.require("electron");
    const menu = ipc.Menu.getApplicationMenu();
    function fi(items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === "new-chat") return items[i];
        if (items[i].submenu) {
          const f = fi(items[i].submenu.items);
          if (f) return f;
        }
      }
      return undefined;
    }
    const item = fi(menu ? menu.items : []);
    if (item) item.click(undefined, ipc.BrowserWindow.getFocusedWindow() || ipc.BrowserWindow.getAllWindows()[0]);
  });
}

async function installRecorder(app) {
  await app.evaluate(async function() {
    const ipc = process.mainModule.require("electron");
    const h = ipc.ipcMain._invokeHandlers;
    const prev = h.get("host:invoke");
    if (!prev) return;
    globalThis.__cm = {};   

    ipc.ipcMain.removeHandler("host:invoke");
    ipc.ipcMain.handle("host:invoke", async function(ev, req) {
      const m = req.module, a = req.action, p = req.payload;

      if (m === "chat" && a === "sendWithMedia") {
        const wm = p && p.workMode;
        const pmMap = {plan:"none", build:"full", review:"minimal", docsData:"minimal"};
        const pm = wm ? (pmMap[wm] || undefined) : undefined;
        globalThis.__cm.last = Object.assign({}, p, {workMode: wm, promptMode: pm});
        return {id:req.id, ok:true, data:{success:true, result:{runId:"r"}}};
      }
      return prev(ev, req);
    });
  });
}

function mkMocks() {
  const k = (m, p) => stableStringify([m, p || null]);
  const ok = (d) => ({ ok:true, data:d });
  const js = (j) => ({ status:200, ok:true, json:j });
  return {
    gatewayStatus: { state:"running", port:18789, pid:12345 },
    gatewayRpc: {
      [k("sessions.list", {})]: { success:true, result:{sessions:[{key:SESSION_KEY, displayName:"main"}]} },
      [k("chat.history", {sessionKey:SESSION_KEY, limit:200, maxChars:500000})]: { success:true, result:{messages:[]} },
    },
    hostApi: {
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
  for (const mode of ["plan","build","review","docsData"]) {
    test("promptMode for " + mode, async ({ launchElectronApp }) => {
      const app = await launchElectronApp({ skipSetup:true });
      try {
        await installIpcMocks(app, mkMocks());
        await installRecorder(app);
        const page = await getStableWindow(app);
        await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout:30000 });
        // Set mock workspace state directly (faster than Settings UI)
        WS.state = { workMode: mode };
        await app.evaluate(function(m) { globalThis.__testWorkMode = m; }, mode);
        await openNewChat(app);
        await expect(page.getByTestId("chat-composer-input")).toBeVisible();
        await page.getByTestId("chat-composer-input").click();
        await page.getByTestId("chat-composer-input").fill("Test msg");
        await page.getByTitle("Send").click();
        const payload = await app.evaluate(() => globalThis.__cm && globalThis.__cm.last);
        expect(payload).toBeDefined();
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
      await installIpcMocks(app, mkMocks());
      await installRecorder(app);
      const page = await getStableWindow(app);
      await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout:30000 });
      await page.getByTestId("chat-composer-input").fill("Hello");
      await page.getByTitle("Send").click();
      const payload = await app.evaluate(() => globalThis.__cm && globalThis.__cm.last);
      expect(payload).toBeDefined();
      expect(payload.promptMode).toBe("full");
    } finally { await closeElectronApp(app); }
  });
});