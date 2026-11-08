import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, getStableWindow, closeElectronApp } from "./fixtures/electron";

test("queries all task pages and filters without losing task identity", async ({
  launchElectronApp,
  homeDir,
}, info) => {
  test.setTimeout(180_000);
  const root = join(homeDir, "task-pages");
  await mkdir(root, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const created = await page.evaluate(async (root) => {
      const result = await window.verseClaw!.hostInvoke<{ activeWorkspaceId: string }>({
        id: crypto.randomUUID(),
        module: "workspaces",
        action: "create",
        payload: { name: "Task pages", rootPath: root, agentId: "main" },
      });
      if (!result.ok) throw new Error(result.error?.message);
      return result.data;
    }, root);
    const ids = await page.evaluate(async (workspaceId) => {
      const ids: string[] = [];
      for (let index = 0; index < 55; index++) {
        const result = await window.verseClaw!.hostInvoke<{
          success: boolean;
          result: { task: { contract: { taskNodeId: string } } };
        }>({
          id: crypto.randomUUID(),
          module: "taskLedger",
          action: "command",
          payload: {
            workspaceId,
            command: {
              action: "create",
              requestId: `page-${index}`,
              contract: {
                objective: `Task page ${String(index).padStart(2, "0")}`,
                target: ".",
                constraints: [],
                acceptance: [
                  {
                    id: "v",
                    description: "Explicit verifier",
                    verification: { kind: "owner-receipt", owner: "fixture" },
                  },
                ],
              },
            },
          },
        });
        if (!result.ok || !result.data.success)
          throw new Error("Task fixture could not be persisted");
        ids.push(result.data.result.task.contract.taskNodeId);
      }
      return ids;
    }, created.activeWorkspaceId);
    expect(new Set(ids).size).toBe(55);
    await page.reload();
    await page.getByTestId("sidebar-footer-menu-trigger").click();
    await page.getByTestId("sidebar-more-task-ledger").click();
    await page.getByRole("tab", { name: "Persistent tasks" }).click();
    await expect(page.getByTestId("managed-task")).toHaveCount(50);
    await page.getByRole("button", { name: "Load more tasks" }).click();
    await expect(page.getByTestId("managed-task")).toHaveCount(55);
    await page.getByLabel("Search persistent tasks", { exact: true }).fill("Task page 02");
    await expect(page.getByTestId("managed-task")).toHaveCount(1);
    await expect(page.getByTestId("managed-task")).toContainText("Task page 02");
    await page.getByLabel("Task status", { exact: true }).click();
    await page.getByRole("option", { name: "Accepted", exact: true }).click();
    await expect(page.getByTestId("managed-task")).toHaveCount(0);
    await page.getByLabel("Task status", { exact: true }).click();
    await page.getByRole("option", { name: "All tasks", exact: true }).click();
    await expect(page.getByTestId("managed-task")).toHaveCount(1);
    await expect(page.getByTestId("managed-task")).toBeInViewport();
    await page.screenshot({ path: info.outputPath("filtered-task.png") });
    await writeFile(
      info.outputPath("pagination-readback.json"),
      JSON.stringify(
        {
          driven_by: "agent",
          workspaceId: created.activeWorkspaceId,
          createdIds: ids,
          pages: [50, 55],
          filtered: "Task page 02",
        },
        null,
        2,
      ),
    );
  } finally {
    await closeElectronApp(app);
  }
});
