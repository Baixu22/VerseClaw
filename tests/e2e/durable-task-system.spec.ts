import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeElectronApp, expect, getStableWindow, test } from "./fixtures/electron";

test("persists a product goal through actual Main storage and page reload", async ({
  launchElectronApp,
  homeDir,
}, testInfo) => {
  const workspace = join(homeDir, "task-project");
  await mkdir(workspace, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspace, windowsHide: true, stdio: "pipe" });
  await writeFile(join(workspace, "artifact.txt"), "approved output");
  const hash = createHash("sha256").update("approved output").digest("hex");
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    const created = await page.evaluate(async (root) => {
      const result = await window.verseClaw!.hostInvoke({
        id: crypto.randomUUID(),
        module: "workspaces",
        action: "create",
        payload: { name: "Task system acceptance", rootPath: root, agentId: "main" },
      });
      if (!result.ok) throw new Error(result.error?.message);
      return result.data;
    }, workspace);
    expect(created).toBeTruthy();
    await page.reload();
    await page.getByTestId("sidebar-footer-menu-trigger").click();
    await page.getByTestId("sidebar-more-task-ledger").click();
    await page.getByRole("tab", { name: "Persistent tasks" }).click();
    await expect(page.getByTestId("managed-tasks")).toBeVisible();
    await page.getByRole('button', { name: 'Create persistent task', exact: true }).click();
    await page
      .getByLabel("Objective", { exact: true })
      .fill("Keep the approved artifact across sessions");
    await page.getByLabel("Artifact path relative to the worktree").fill("artifact.txt");
    await page
      .getByLabel("Acceptance criterion", { exact: true })
      .fill("Artifact contains the approved output");
    await page.getByLabel("Verification method", { exact: true }).click();
    await page.getByRole("option", { name: "Artifact matches the approved content hash" }).click();
    await page.getByLabel("Expected artifact SHA-256").fill(hash);
    await page.getByRole("button", { name: "Create persistent task" }).click();
    await expect(page.getByTestId("managed-task")).toContainText(
      "Keep the approved artifact across sessions",
    );
    await expect(page.getByTestId("managed-task")).toContainText("Unassigned");
    await expect(page.getByTestId('managed-task')).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("persistent-goal-created.png"),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("tab", { name: "Persistent tasks" }).click();
    await expect(page.getByTestId("managed-task")).toHaveCount(1);
    await expect(page.getByTestId('managed-task')).toBeInViewport();
    await expect(page.getByTestId("managed-task")).toContainText(
      "Keep the approved artifact across sessions",
    );
    await page.screenshot({
      path: testInfo.outputPath("persistent-goal-restored.png"),
      fullPage: true,
    });
    const readback = await page.evaluate(async () => {
      const ws = await window.verseClaw!.hostInvoke<{ activeWorkspaceId: string }>({
        id: crypto.randomUUID(),
        module: "workspaces",
        action: "list",
      });
      if (!ws.ok) throw new Error(ws.error?.message);
      return window.verseClaw!.hostInvoke({
        id: crypto.randomUUID(),
        module: "taskLedger",
        action: "managedTasks",
        payload: { workspaceId: ws.data.activeWorkspaceId },
      });
    });
    expect(readback.ok).toBe(true);
    await writeFile(
      testInfo.outputPath("owner-readback.json"),
      JSON.stringify({ driven_by: "agent", actor: "playwright", workspace, readback }, null, 2),
    );
  } finally {
    await closeElectronApp(app);
  }
});
