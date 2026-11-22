import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskCredential, TaskView } from "../../shared/task-system/types";
import type { TaskTraceReport } from "../../shared/task-system/trace";
import en from "../../shared/i18n/locales/en/taskLedger.json";
import zh from "../../shared/i18n/locales/zh/taskLedger.json";
import ja from "../../shared/i18n/locales/ja/taskLedger.json";
import ru from "../../shared/i18n/locales/ru/taskLedger.json";
import {
  closeElectronApp,
  expect,
  getStableWindow,
  pinWindowContentSize,
  test,
} from "./fixtures/electron";
import { hostInvoke, SCRIPTED_LLM_USAGE, startScriptedLlm } from "./fixtures/fp-p1-harness";
import {
  configureSessionChainProvider,
  createSessionChainProject,
  createSessionChainTask,
} from "./fixtures/session-task-chain";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const content = "V1 source-bound task artifact\n";
const marker = "V1_TRACE_RUN";
const command = "node verify.cjs";
type CommandResult<T> = { success: boolean; result: T; error?: string };

test("V1: query actual execution and retain acceptance after deleting its source session", async ({
  launchElectronApp,
  userDataDir,
}, info) => {
  test.setTimeout(360_000);
  const root = info.outputPath("project");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true, stdio: "pipe" });
  await writeFile(
    join(root, "verify.cjs"),
    `const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');assert.equal(fs.readFileSync(path.join(__dirname,'artifact.txt'),'utf8'),${JSON.stringify(content)});console.log('V1_REAL_CHECK_OK');`,
  );
  const evidence: Record<string, unknown> = {
    schemaVersion: "clawx.v1.traceability/v1",
    driven_by: "agent",
    actor: "playwright-v1-trace",
    realHumanEvidence: false,
    scope: "rebuilt source Electron and compiled Gateway with a scripted model",
    provider: "local-scripted",
    candidate: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    testSourceSha256: sha(await readFile("tests/e2e/autonomous-task-traceability.spec.ts")),
    status: "running",
    stages: {},
    screenshots: [],
  };
  const stages = evidence.stages as Record<string, unknown>;
  const record = async (name: string, value: unknown) => {
    stages[name] = value;
    await writeFile(info.outputPath("traceability.json"), JSON.stringify(evidence, null, 2));
  };
  const llm = await startScriptedLlm((text, results) => {
    if (!text.includes(marker)) return { text: "Ready." };
    if (!results.v1write)
      return {
        toolCall: { id: "v1write", name: "write", args: { path: "artifact.txt", content } },
      };
    if (!results.v1check) return { toolCall: { id: "v1check", name: "exec", args: { command } } };
    return { text: "V1_TRACE_READY" };
  });
  const app = await launchElectronApp({
    skipSetup: true,
    env: {
      CLAWX_TASK_SCOPE_BRIDGE: "1",
      CLAWX_EXECUTION_STATE_PATH: info.outputPath("execution-state.sqlite"),
    },
  });
  try {
    let page = await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, root, "Trace Project");
    await record("project", project);
    const task = await createSessionChainTask(app, project.workspaceId, "v1-task-create", {
      objective: "Deliver a traceable artifact",
      target: "artifact.txt",
      constraints: ["Preserve the source and original verification command"],
      acceptance: [
        {
          id: "bytes",
          description: "Artifact matches the approved bytes",
          verification: { kind: "file-sha256", path: "artifact.txt", sha256: sha(content) },
        },
        {
          id: "check",
          description: "The real verification command exits zero",
          verification: {
            kind: "tool-result",
            tool: "exec",
            command,
            files: ["verify.cjs", "artifact.txt"],
            exitCode: 0,
          },
        },
      ],
    });
    const taskNodeId = task.contract.taskNodeId;
    const bound = await hostInvoke<{ success: boolean; error?: string }>(
      app,
      "workspaces",
      "bindCoordinator",
      {
        workspaceId: project.workspaceId,
        sessionKey: project.sessionKey,
        agentId: "main",
        expectedRevision: 0,
        taskLedgerNodeIds: [taskNodeId],
        environment: { kind: "local", rootPath: root },
        archiveRestorePolicy: "restore",
      },
    );
    expect(bound.success, bound.error).toBe(true);
    const claimed = await hostInvoke<CommandResult<TaskView>>(app, "taskLedger", "command", {
      workspaceId: project.workspaceId,
      command: {
        action: "claim",
        taskNodeId,
        sessionKey: project.sessionKey,
        requestId: "v1-claim",
      },
    });
    expect(claimed.success, claimed.error).toBe(true);
    const credential: TaskCredential = claimed.result.claim!;
    expect(credential.generation).toBe(project.generation);
    await record("claimed", claimed);
    const trace = (expectations: Record<string, unknown> = {}) =>
      hostInvoke<{ success: boolean; report: TaskTraceReport }>(app, "taskLedger", "trace", {
        workspaceId: project.workspaceId,
        taskNodeId,
        ...expectations,
      }).then((result) => {
        expect(result.success).toBe(true);
        return result.report;
      });
    const sent = await hostInvoke(app, "chat", "sendWithMedia", {
      sessionKey: project.sessionKey,
      message: `${marker}: write artifact.txt, run the specified check, then report the result.`,
      idempotencyKey: "v1-real-run",
    });
    await record("send", sent);
    await expect
      .poll(() => llm.log.some((request) => request.issued === "text:V1_TRACE_READY"), {
        timeout: 90_000,
      })
      .toBe(true);
    await expect
      .poll(
        async () => {
          const report = await trace();
          return (
            report.runs.length > 0 &&
            report.runs.every((run) => run.endedAt !== null) &&
            report.operations.length >= 2 &&
            report.operations.every((operation) => operation.state === "completed")
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(await readFile(join(root, "artifact.txt"), "utf8")).toBe(content);
    const beforeSubmit = await trace();
    await record("executed", beforeSubmit);
    expect(
      beforeSubmit.operations.find((operation) => operation.tool === "exec")?.effectReceiptIds
        .length,
    ).toBeGreaterThan(0);
    expect(beforeSubmit.runs[0].provenance?.run?.scope.workspaceId).toBe(project.workspaceId);
    expect(beforeSubmit.runs[0].provenance?.checkout?.bindingRevision).toBeGreaterThan(0);
    const candidate = `v1:${sha(content)}`;
    for (const body of [
      {
        action: "verifyFile",
        credential,
        criterionId: "bytes",
        path: "artifact.txt",
        expectedSha256: sha(content),
        candidate,
      },
      { action: "submit", credential, candidate },
      { action: "accept", credential, candidate },
    ]) {
      const result = await hostInvoke<CommandResult<unknown>>(app, "taskLedger", "command", {
        workspaceId: project.workspaceId,
        command: body,
      });
      expect(result.success, result.error).toBe(true);
    }
    const accepted = await trace({
      revision: task.contract.revision,
      digest: task.contract.digest,
      candidate,
    });
    await record("accepted", accepted);
    expect(accepted.status).toBe("current");
    expect(accepted.task.contract.state).toBe("done");
    expect(accepted.checks).toHaveLength(2);
    expect(accepted.checks.every((check) => check.state === "current")).toBe(true);
    const modelRequests = llm.log.filter((request) =>
      ["v1write", "v1check", "text:V1_TRACE_READY"].includes(request.issued ?? ""),
    );
    expect(modelRequests).toHaveLength(3);
    expect(modelRequests.map((request) => request.issued)).toEqual([
      "v1write",
      "v1check",
      "text:V1_TRACE_READY",
    ]);
    expect(accepted.costs.calls).toBe(modelRequests.length);
    for (const record of accepted.costs.records) {
      expect(record.run).toMatchObject({
        runId: accepted.runs[0].runId,
        scope: { workspaceId: project.workspaceId, sessionKey: project.sessionKey },
      });
    }
    expect(new Set(accepted.costs.records.map((record) => record.call.callId)).size).toBe(
      modelRequests.length,
    );
    expect(accepted.costs.totalTokens).toBe(modelRequests.length * SCRIPTED_LLM_USAGE.total_tokens);
    expect(accepted.costs.totalUsd).toBeNull();
    const eventCount = accepted.events.length;
    for (const [locale, labels] of Object.entries({ en, zh, ja, ru })) {
      await hostInvoke(app, "settings", "set", { key: "language", value: locale });
      await page.reload();
      page = await getStableWindow(app);
      await page.getByTestId("sidebar-footer-menu-trigger").click();
      await page.getByTestId("sidebar-more-task-ledger").click();
      await page.getByRole("tab", { name: labels.managed.tab, exact: true }).click();
      await page.getByLabel(labels.managed.search, { exact: true }).fill(task.contract.objective);
      const card = page.getByTestId("managed-task");
      await expect(card).toHaveCount(1);
      const panel = card.getByTestId("task-trace-panel");
      await panel.locator("summary").first().focus();
      await panel.locator("summary").first().press("Enter");
      await expect(panel.getByTestId("task-trace-status")).toHaveText(labels.trace.states.current);
      await expect(panel.getByTestId("task-trace-cost")).toContainText(labels.trace.unknown);
      for (const width of [1280, 960]) {
        const viewport = await pinWindowContentSize(app, { width, height: 900 });
        const window = await app.browserWindow(page);
        const zoomFactor = await window.evaluate((win) => win.webContents.getZoomFactor());
        const rendererViewport = await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }));
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        const file = info.outputPath(`task-trace-${locale}-${width}.png`);
        await page.screenshot({ path: file });
        (evidence.screenshots as unknown[]).push({
          locale,
          width,
          viewport,
          zoomFactor,
          rendererViewport,
          path: file,
          sha256: sha(await readFile(file)),
          overflow,
        });
      }
    }
    expect((await trace()).events).toHaveLength(eventCount);
    const transcript = join(
      userDataDir,
      "openclaw-source-state",
      "agents",
      "main",
      "sessions",
      `${project.generation}.jsonl`,
    );
    expect(existsSync(transcript)).toBe(true);
    const removed = await hostInvoke(app, "sessions", "delete", { id: project.sessionKey });
    await record("sessionDeleted", removed);
    expect(existsSync(transcript)).toBe(false);
    const retained = await trace();
    await record("afterSessionDeletion", retained);
    expect(retained.task.contract.state).toBe("done");
    expect(retained.status).toBe("current");
    expect(retained.checks.map((check) => check.receipt.receiptId)).toEqual(
      accepted.checks.map((check) => check.receipt.receiptId),
    );
    expect(retained.costs.records).toEqual(accepted.costs.records);
    await writeFile(join(root, "artifact.txt"), "modified artifact\n");
    const staleArtifact = await trace();
    await record("artifactChanged", staleArtifact);
    expect(staleArtifact.status).toBe("stale");
    expect(staleArtifact.diagnostics.some((d) => d.code === "artifact_changed")).toBe(true);
    const staleSource = await trace({ digest: sha("different source") });
    await record("sourceChanged", staleSource);
    expect(staleSource.status).toBe("stale");
    expect(staleSource.diagnostics.some((d) => d.code === "source_changed")).toBe(true);
    expect(llm.anomalies).toEqual([]);
    await record("modelRequests", modelRequests);
    evidence.status = "completed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>((resolve) => llm.server.close(() => resolve()));
    await writeFile(info.outputPath("traceability.json"), JSON.stringify(evidence, null, 2));
  }
});
