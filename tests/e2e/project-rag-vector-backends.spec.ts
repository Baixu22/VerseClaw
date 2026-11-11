import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freemem } from "node:os";
import type { Page } from "@playwright/test";
import { closeElectronApp, expect, getStableWindow, test } from "./fixtures/electron";
import { allocatePort, buildMockProviderConfig } from "./fixtures/fp-p1-harness";

type Json = Record<string, unknown>;
async function waitForGateway(page: Page) {
  await expect
    .poll(
      async () => {
        const result = await page.evaluate(async () => {
          const response = await window.verseClaw!.hostInvoke({
            id: crypto.randomUUID(),
            module: "gateway",
            action: "status",
          });
          return response.ok ? response.data : undefined;
        });
        return (result as { state?: string } | undefined)?.state;
      },
      { timeout: 120_000 },
    )
    .toBe("running");
}

async function host<T = Json>(
  page: Page,
  module: string,
  action: string,
  payload?: Json,
): Promise<T> {
  return page.evaluate(
    async (request) => {
      const result = await window.verseClaw!.hostInvoke({
        id: crypto.randomUUID(),
        module: request.module,
        action: request.action,
        ...(request.payload ? { payload: request.payload } : {}),
      });
      if (!result.ok) throw Error(result.error?.message ?? "Host request failed");
      return result.data as T;
    },
    { module, action, payload },
  );
}

test("Project RAG vector settings switch native backends and preserve owner revocation across restart", async ({
  homeDir,
  userDataDir,
  launchElectronApp,
}, testInfo) => {
  const assets = process.env.PROJECT_RAG_E2E_ASSETS_DIR;
  test.skip(!assets, "Set PROJECT_RAG_E2E_ASSETS_DIR for the real native model/vector journey.");
  test.setTimeout(360_000);
  const workspace = join(homeDir, "vector-workspace"),
    vault = join(homeDir, "vector-vault");
  await mkdir(workspace, { recursive: true });
  await mkdir(join(vault, "concepts"), { recursive: true });
  const app = await launchElectronApp({
    skipSetup: true,
    env: { VERSE_CLAW_OPENCLAW_RUNTIME: "source" },
  });
  const steps: Record<string, boolean> = {};
  const receipt: Json = {
    actor: "codex/project-rag-vector-electron",
    driven_by: "agent",
    status: "fail",
    steps,
    freeMemoryAtStartMiB: Math.floor(freemem() / 1024 / 1024),
  };
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId("main-layout")).toBeVisible({ timeout: 60_000 });
    const created = await host(page, "workspaces", "create", {
      name: "Project vector fixture",
      rootPath: workspace,
      agentId: "main",
      permissionMode: "fullAccess",
    });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    const config = buildMockProviderConfig(9, workspace);
    config.channels = {};
    config.update = { checkOnStart: false };
    config.plugins = {
      enabled: true,
      entries: {
        "memory-wiki": {
          enabled: true,
          config: {
            vaultMode: "isolated",
            vault: { path: vault },
            search: { backend: "local", corpus: "wiki" },
          },
        },
      },
    };
    const modelName = "6fa0c02a9c302be6-embeddinggemma-300m-qat-Q8_0.gguf";
    for (const state of [join(homeDir, ".openclaw"), join(userDataDir, "openclaw-source-state")]) {
      await mkdir(join(state, "models/project-rag"), { recursive: true });
      await writeFile(join(state, "openclaw.json"), JSON.stringify(config, null, 2));
      await copyFile(join(assets!, modelName), join(state, "models/project-rag", modelName));
    }
    const file = join(vault, "concepts/source.md");
    const raw = (revision: number, body: string, denied = false) =>
      `---\ntitle: Gateway deployment\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: ${owner.id}\n${denied ? "acl:\n  read: [other]\n" : ""}---\n${body}\n`;
    await writeFile(file, raw(1, "The gateway deployment port is 18789."));
    await host(page, "settings", "set", { key: "gatewayPort", value: await allocatePort() });
    const start = async () => {
      try {
        await host(page, "gateway", "start");
      } catch (error) {
        if (!String(error).includes("timed out")) throw error;
      }
      await expect
        .poll(async () => (await host(page, "gateway", "status")).state, { timeout: 120_000 })
        .toBe("running");
    };
    await start();
    await page.evaluate(() => {
      window.location.hash = "#/settings/models";
    });
    await waitForGateway(page);
    await page.getByTestId("embedding-mode").selectOption("local");
    await page.getByTestId("embedding-configure").click();
    await expect(page.getByTestId("embedding-status")).toHaveAttribute("data-state", "ready", {
      timeout: 300_000,
    });
    await page.getByTestId("vector-configure").click();
    await expect(page.getByTestId("vector-status")).toHaveAttribute("data-state", "ready", {
      timeout: 90_000,
    });
    const rpc = async (operation: string, params: Json = {}) => {
      const value = await host(page, "gateway", "rpc", {
        method: "wiki.vector." + operation,
        params: { workspaceId: owner.id, sessionKey: owner.activeSessionKey, ...params },
        timeoutMs: 60_000,
      });
      if (operation === "status") {
        receipt.lastVectorStatus = value;
        if (value.status === "unavailable") {
          receipt.lastEmbeddingStatus = await host(page, "knowledge", "embeddingStatus");
          receipt.freeMemoryMiB = Math.floor(freemem() / 1024 / 1024);
        }
      }
      return value;
    };
    const portable = await rpc("search", { query: "gateway deployment port" });
    expect(portable.effectiveBackend).toBe("sqlite-flat");
    expect(
      (portable.candidates as Array<{ quote: string }>).some((row) => row.quote.includes("18789")),
    ).toBe(true);
    receipt.portable = portable;
    steps.portable = true;
    await page.screenshot({
      path: testInfo.outputPath("vector-portable-ready.png"),
      fullPage: true,
    });
    await page.getByTestId("vector-backend").selectOption("lancedb-ann");
    await page.getByTestId("vector-configure").click();
    await expect
      .poll(
        async () => {
          const value = await rpc("status");
          return (value.generation as { backend?: string })?.backend;
        },
        { timeout: 90_000 },
      )
      .toBe("lancedb-ann");
    const ann = await rpc("search", { query: "gateway deployment port" });
    expect(ann.effectiveBackend).toBe("lancedb-ann");
    receipt.ann = ann;
    steps.annSwitch = true;
    await writeFile(file, raw(2, "This source has been revoked.", true));
    expect((await rpc("search", { query: "gateway deployment port" })).candidates).toEqual([]);
    steps.aclImmediate = true;
    await writeFile(file, raw(3, "The restored gateway deployment port is 19999."));
    await host(page, "gateway", "rpc", {
      method: "wiki.index.reconcile",
      params: { workspaceId: owner.id, sessionKey: owner.activeSessionKey },
    });
    await host(page, "gateway", "rpc", {
      method: "wiki.index.idle",
      params: { workspaceId: owner.id, sessionKey: owner.activeSessionKey },
    });
    await rpc("idle");
    expect((await rpc("search", { query: "gateway deployment port" })).candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quote: expect.stringContaining("19999") }),
      ]),
    );
    steps.appendVisible = true;
    receipt.memoryBeforeRestartMiB = Math.floor(freemem() / 1024 / 1024);
    await host(page, "gateway", "stop");
    await start();
    await expect.poll(async () => (await rpc("status")).status, { timeout: 120_000 }).toBe("ready");
    steps.restart = true;
    await page.evaluate(() => {
      window.location.hash = "#/settings/general";
    });
    await expect(page.getByTestId("knowledge-vector-settings")).toHaveCount(0);
    await page.evaluate(() => {
      window.location.hash = "#/settings/models";
    });
    await expect(page.getByTestId("vector-backend")).toHaveValue("lancedb-ann");
    steps.formRestored = true;
    const restored = await rpc("search", { query: "gateway deployment port" });
    expect(restored.effectiveBackend).toBe("lancedb-ann");
    receipt.restored = restored;
    await page.screenshot({ path: testInfo.outputPath("vector-ann-ready.png"), fullPage: true });
    await unlink(file);
    expect((await rpc("search", { query: "gateway deployment port" })).candidates).toEqual([]);
    steps.deletedImmediate = true;
    await writeFile(file, raw(4, "The old workspace private deployment port is 17777."));
    const nextRoot = join(homeDir, "next-vector-workspace");
    await mkdir(nextRoot, { recursive: true });
    const nextCreated = await host(page, "workspaces", "create", {
      name: "Next vector workspace",
      rootPath: nextRoot,
      agentId: "main",
      permissionMode: "fullAccess",
    });
    const nextOwner = nextCreated.activeWorkspace as { id: string; activeSessionKey: string };
    receipt.memoryBeforeWorkspaceSwitchMiB = Math.floor(freemem() / 1024 / 1024);
    await page.evaluate(() => {
      window.location.hash = "#/settings/general";
    });
    await expect(page.getByTestId("knowledge-vector-settings")).toHaveCount(0);
    await page.evaluate(() => {
      window.location.hash = "#/settings/models";
    });
    await expect
      .poll(async () => {
        const result = await host(page, "knowledge", "vectorStatus");
        const vector = result.vector as { status?: string; generation?: unknown } | undefined;
        return result.success && vector?.status === "disabled" && vector.generation === null;
      })
      .toBe(true);
    await page.getByTestId("embedding-mode").selectOption("local");
    await page.getByTestId("embedding-configure").click();
    await expect
      .poll(
        async () => {
          const result = await host(page, "knowledge", "embeddingStatus");
          return result.success && (result.embedding as { status?: string })?.status === "ready";
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    await page.getByTestId("vector-backend").selectOption("sqlite-flat");
    await page.getByTestId("vector-configure").click();
    await expect
      .poll(
        async () => {
          const result = await host(page, "knowledge", "vectorStatus");
          return result.success && (result.vector as { status?: string })?.status === "ready";
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    const nextResult = await host(page, "gateway", "rpc", {
      method: "wiki.vector.search",
      params: {
        workspaceId: nextOwner.id,
        sessionKey: nextOwner.activeSessionKey,
        query: "deployment port",
      },
    });
    expect(nextResult.candidates).toEqual([]);
    steps.workspaceSwitch = true;
    steps.priorSourceRejected = true;
    receipt.workspaceSwitch = { from: owner.id, to: nextOwner.id, priorSourceRejected: true };
    await expect(page.getByTestId("vector-status")).toHaveAttribute("data-state", "ready");
    await page.screenshot({
      path: testInfo.outputPath("vector-new-workspace.png"),
      fullPage: true,
    });
    await page.getByTestId("vector-disable").click();
    await expect(page.getByTestId("vector-status")).toHaveAttribute("data-state", "disabled");
    steps.disabled = true;
    receipt.status = "pass";
  } finally {
    await writeFile(
      testInfo.outputPath("vector-lifecycle-receipt.json"),
      JSON.stringify(receipt, null, 2),
    );
    await testInfo.attach("vector-lifecycle-receipt", {
      body: await readFile(testInfo.outputPath("vector-lifecycle-receipt.json")),
      contentType: "application/json",
    });
    try {
      await host(await getStableWindow(app), "gateway", "stop");
    } catch {
      /* Startup can fail before a Gateway exists. */
    }
    await closeElectronApp(app);
  }
});
