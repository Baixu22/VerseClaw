import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { closeElectronApp, expect, getStableWindow, test } from "./fixtures/electron";
import { allocatePort, buildMockProviderConfig } from "./fixtures/fp-p1-harness";
import type { KnowledgeOperationsResult } from "../../shared/knowledge/operations";
import type { KnowledgeObservabilityResult } from "../../shared/knowledge/observability";

type Json = Record<string, unknown>;
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

test("Project RAG operations manage canonical config, pause, recovery, revocation and rollback", async ({
  homeDir,
  userDataDir,
  launchElectronApp,
}, testInfo) => {
  test.setTimeout(480000);
  const workspace = join(homeDir, "rag12-workspace"),
    vault = join(homeDir, "rag12-vault");
  await mkdir(workspace, { recursive: true });
  await mkdir(join(vault, "concepts"), { recursive: true });
  const app = await launchElectronApp({
    skipSetup: true,
    env: { VERSE_CLAW_OPENCLAW_RUNTIME: "source" },
  });
  const receipt: Json = {
    schema: "ProjectRagOperationsElectron/v1",
    actor: "codex/project-rag-g2-20261115",
    driven_by: "agent",
    realHumanEvidence: false,
    platform: process.platform,
    arch: process.arch,
    candidate: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: "fail",
    steps: {},
  };
  const steps = receipt.steps as Json;
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId("main-layout")).toBeVisible({ timeout: 60000 });
    const created = await host(page, "workspaces", "create", {
      name: "Agent RAG operations",
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
            vault: { path: vault, renderMode: "native" },
            search: { backend: "local", corpus: "wiki" },
          },
        },
      },
    };
    const state = join(userDataDir, "openclaw-source-state");
    for (const dir of [join(homeDir, ".openclaw"), state]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "openclaw.json"), JSON.stringify(config, null, 2));
    }
    const file = join(vault, "concepts/operations.md");
    const raw = (revision: number, text: string, acl = "") =>
      `---\ntitle: Agent operations source\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: ${owner.id}\n${acl}---\n# Operations\n\n${text}\n`;
    await writeFile(file, raw(1, "RAG12_UI_INITIAL"));
    await host(page, "settings", "set", { key: "gatewayPort", value: await allocatePort() });
    const start = async () => {
      try {
        await host(page, "gateway", "start");
      } catch (error) {
        if (!String(error).includes("timed out")) throw error;
      }
      await expect
        .poll(async () => (await host(page, "gateway", "status")).state, { timeout: 120000 })
        .toBe("running");
    };
    await start();
    await page.evaluate(() => {
      window.location.hash = "#/settings/models";
    });
    const panel = page.getByTestId("knowledge-operations-settings");
    await expect(panel).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "disabled");
    await expect(page.getByTestId("operations-owner")).toHaveAttribute("data-owner", owner.id);
    await expect(panel.getByRole("link")).toHaveAttribute("href", "#/knowledge");
    await expect(page.getByTestId("operations-profile")).toHaveValue("local");
    await expect(page.getByTestId("operations-answer-mode")).toHaveValue("strict");
    steps.canonicalDefaults = true;
    await page.getByTestId("index-enable").click();
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30000,
    });
    await expect(page.getByTestId("index-generations")).toHaveText("1");
    const snapshot = () => host<KnowledgeOperationsResult>(page, "knowledge", "operationsStatus");
    receipt.initial = await snapshot();
    expect(
      (receipt.initial as KnowledgeOperationsResult).operations?.index.storage.bytes,
    ).toBeGreaterThan(0);
    await panel.screenshot({ path: testInfo.outputPath("rag12-ready.png") });
    steps.ownerIndexReady = true;

    await page.getByTestId("index-pause").click();
    await expect.poll(async () => (await snapshot()).operations?.index.status).toBe("paused");
    expect((await snapshot()).operations?.index.activeWorker).toBe(false);
    await writeFile(file, raw(2, "RAG12_UI_UPDATED"));
    await page.getByTestId("index-reconcile").click();
    await expect(page.getByTestId("index-lag")).toHaveText("1");
    await panel.screenshot({ path: testInfo.outputPath("rag12-paused.png") });
    await host(page, "gateway", "stop");
    await writeFile(file, raw(3, "RAG12_UI_UPDATED_WHILE_STOPPED"));
    await start();
    await expect
      .poll(async () => (await snapshot()).operations?.index.status, { timeout: 30000 })
      .toBe("paused");
    receipt.restoredPause = await snapshot();
    expect((receipt.restoredPause as KnowledgeOperationsResult).operations?.index).toMatchObject({
      activeWorker: false,
      workerThreadIds: [],
    });
    expect((receipt.restoredPause as KnowledgeOperationsResult).operations?.index.sources.every(source => !source.eligible)).toBe(true);
    steps.pauseAndRestart = true;
    await expect(page.getByTestId("index-resume")).toBeEnabled({ timeout: 15000 });
    await page.getByTestId("index-resume").click();
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30000,
    });
    const retrieved = await host(page, "knowledge", "retrieve", {
      query: "RAG12_UI_UPDATED",
      profile: "local",
    });
    expect(JSON.stringify(retrieved)).toContain("RAG12_UI_UPDATED_WHILE_STOPPED");
    steps.resumeUpdatedOwnerBytes = true;
    const diagnostics = () => host<KnowledgeObservabilityResult>(page, "knowledge", "observabilityStatus");
    await page.getByTestId("retrieval-diagnostics-refresh").click();
    await expect(page.getByTestId("retrieval-samples")).toHaveText("1");
    const observed = (await diagnostics()).observability!;
    expect(observed.receipts).toHaveLength(1);
    expect(observed.receipts[0].usage.costUsd).toBeNull();
    expect(JSON.stringify(observed)).not.toContain("RAG12_UI_UPDATED_WHILE_STOPPED");
    const feedbackId = "rag17-feedback-once";
    for (let attempt = 0; attempt < 2; attempt++) {
      const feedback = await host<KnowledgeObservabilityResult>(page, "knowledge", "retrievalFeedback", {
        operationId: feedbackId, receiptId: observed.receipts[0].receiptId, action: "attach",
      });
      expect(feedback.success).toBe(true);
      expect(feedback.observability?.receipts[0].feedback.attach).toBe(1);
      expect(feedback.observability?.policies).toEqual(observed.policies);
    }
    const conflicting = await host<KnowledgeObservabilityResult>(page, "knowledge", "retrievalFeedback", {
      operationId: feedbackId, receiptId: observed.receipts[0].receiptId, action: "dismiss",
    });
    expect(conflicting.success).toBe(false);
    const unsealed = await host<KnowledgeObservabilityResult>(page, "knowledge", "policyPromote", {
      operationId: "rag17-reject-unsealed", expectedPolicyDigest: observed.policies[0].digest,
      candidate: { ...observed.policies[0].active, version: "unsealed/v1" }, evaluation: {},
    });
    expect(unsealed.success).toBe(false);
    steps.retrievalReceiptsAndWeakFeedback = true;

    await writeFile(file, raw(4, "RAG12_UI_UPDATED_WHILE_STOPPED", "acl:\n  read: [someone-else]\n"));
    const revoked = await host(page, "knowledge", "retrieve", {
      query: "RAG12_UI_UPDATED",
      profile: "local",
    });
    expect((revoked.retrieval as { results: unknown[] }).results).toHaveLength(0);
    receipt.revoked = revoked;
    steps.revocationRejected = true;
    const afterRevocation = await diagnostics();
    expect(afterRevocation.success).toBe(true);
    expect(afterRevocation.observability?.receipts.every(row => row.sources.length === 0)).toBe(true);
    steps.receiptsRevokedWithSource = true;
    await unlink(file);
    await page.getByTestId("index-reconcile").click();
    await page.getByTestId("index-cleanup").click();
    await expect(page.getByTestId("index-deleted")).toHaveText("1");
    await expect(page.getByTestId("index-cleanup-pending")).toHaveText("0");
    receipt.deleted = await snapshot();
    steps.logicalAndPhysicalCleanup = true;
    const restored = raw(5, "RAG12_UI_RESTORED");
    await writeFile(file, restored);
    await page.getByTestId("index-reconcile").click();
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30000,
    });

    await page.getByTestId("operations-profile").selectOption("quality");
    await page.getByTestId("operations-answer-mode").selectOption("open");
    await page.getByTestId("operations-storage-budget").fill("256");
    await page.getByTestId("operations-save").click();
    await expect
      .poll(async () => (await snapshot()).operations?.config.profile, { timeout: 60000 })
      .toBe("quality");
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "degraded", {
      timeout: 15000,
    });
    receipt.quality = await snapshot();
    expect((receipt.quality as KnowledgeOperationsResult).operations?.config).toMatchObject({
      answerMode: "open",
      maxStorageBytes: 256 * 1024 ** 2,
    });
    const storedConfig = JSON.parse(await readFile(join(state, "openclaw.json"), "utf8"));
    expect(storedConfig.plugins.entries["memory-wiki"].config.retrieval).toEqual({
      profile: "quality",
      answerMode: "open",
      maxStorageBytes: 256 * 1024 ** 2,
    });
    expect((receipt.quality as KnowledgeOperationsResult).operations?.reasons).toEqual(
      expect.arrayContaining(["dense-unavailable", "rerank-unavailable"]),
    );
    await panel.screenshot({ path: testInfo.outputPath("rag12-quality-degraded.png") });
    steps.configPersistedAndCapabilitiesDegraded = true;
    await page.evaluate(() => {
      window.location.hash = "#/?knowledge=ask";
    });
    await expect(page.getByTestId("knowledge-chat-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("knowledge-answer-mode")).toHaveValue("open", { timeout: 30000 });
    steps.defaultAnswerStrategy = true;
    await page.evaluate(() => {
      window.location.hash = "#/settings/models";
    });
    await expect(page.getByTestId("operations-profile")).toHaveValue("quality", { timeout: 15000 });
    await page.getByTestId("index-reconcile").click();
    await page.getByTestId("index-cleanup").click();
    await expect(page.getByTestId("index-lag")).toHaveText("0", { timeout: 30000 });
    // The assistant's existing owner refresh renders related-page annotations.
    // Rollback preserves the current owner revision after that refresh settles.
    const ownerBeforeRollback = await readFile(file, "utf8");
    receipt.ownerBeforeRollback = ownerBeforeRollback;

    const beforeInvalid = await readFile(join(state, "openclaw.json"));
    expect(
      await host(page, "knowledge", "operationsConfigure", { mode: "auto-read" }),
    ).toMatchObject({ success: false });
    expect(
      await host(page, "knowledge", "operationsConfigure", { maxStorageBytes: 0 }),
    ).toMatchObject({ success: false });
    expect(await readFile(join(state, "openclaw.json"))).toEqual(beforeInvalid);
    steps.unknownAndInvalidConfigRejected = true;
    await page.getByTestId("operations-profile").selectOption("local");
    await page.getByTestId("operations-answer-mode").selectOption("strict");
    await page.getByTestId("operations-storage-budget").fill("512");
    await page.getByTestId("operations-save").click();
    await expect
      .poll(async () => (await snapshot()).operations?.config.profile, { timeout: 60000 })
      .toBe("local");
    receipt.rollbackReadback = await snapshot();
    receipt.rollbackGateway = await host(page, "gateway", "status");
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30000,
    });
    expect(await readFile(file, "utf8")).toBe(ownerBeforeRollback);
    await page.getByTestId("index-rebuild").click();
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30000,
    });
    receipt.rollback = await snapshot();
    steps.configAndGenerationRollback = true;
    await panel.screenshot({ path: testInfo.outputPath("rag12-rollback-ready.png") });
    await page.getByTestId("index-disable").click();
    await expect(page.getByTestId("operations-status")).toHaveAttribute("data-state", "disabled");
    expect(await readFile(file, "utf8")).toBe(ownerBeforeRollback);
    steps.disablePreservedOwnerBytes = true;
    receipt.status = "pass";
  } finally {
    try {
      const finalPage = await getStableWindow(app);
      receipt.finalOperations = await host(finalPage, "knowledge", "operationsStatus");
      receipt.finalGateway = await host(finalPage, "gateway", "status");
      if (receipt.status !== "pass") receipt.failureLogs = await host(finalPage, "logs", "recent");
    } catch (error) { receipt.finalReadbackError = String(error); }
    await writeFile(
      testInfo.outputPath("operations-lifecycle-receipt.json"),
      JSON.stringify(receipt, null, 2),
    );
    await testInfo.attach("operations-lifecycle-receipt", {
      body: await readFile(testInfo.outputPath("operations-lifecycle-receipt.json")),
      contentType: "application/json",
    });
    try {
      await host(await getStableWindow(app), "gateway", "stop");
    } catch {
      /* This app owns only its fixture Gateway. */
    }
    await closeElectronApp(app);
  }
});
