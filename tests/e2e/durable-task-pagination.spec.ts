import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, getStableWindow, closeElectronApp } from "./fixtures/electron";

test("queries all task pages and filters without losing task identity", async ({
  launchElectronApp,
  homeDir,
}, info) => {
  test.setTimeout(180_000);
  const root = join(homeDir, "task-pages");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, windowsHide: true, stdio: "pipe" });
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
    const database = join(root, ".git", "verse-claw", "task-ledger.sqlite3");
    const saved = await readFile(database);
    try {
      await writeFile(database, "corrupt database fixture");
      await page.getByTestId("managed-tasks").getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByTestId("managed-tasks").getByRole("status")).toContainText("last successful read");
      await expect(page.getByTestId("managed-task")).toContainText("Task page 02");
      await expect(page.getByRole("button", { name: "Claim for this session", exact: true })).toBeDisabled();
      await page.screenshot({ path: info.outputPath("stale-task-store.png") });
    } finally { await writeFile(database, saved); }
    await page.getByTestId("managed-tasks").getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByTestId("managed-tasks").getByRole("status")).toHaveCount(0);
    await expect(page.getByTestId("managed-task")).toContainText("Task page 02");
    await page.screenshot({ path: info.outputPath("filtered-task.png") });
    for (const language of ["zh", "ja", "ru"]) {
      const labels = JSON.parse(await readFile(join(process.cwd(), "shared/i18n/locales", language, "taskLedger.json"), "utf8"));
      await page.getByTestId("sidebar-nav-settings").click();
      await page.getByTestId("settings-nav-general").click();
      await page.getByTestId("settings-language-select").click();
      await page.getByRole("option",{name:({zh:"中文",ja:"日本語",ru:"Русский"} as Record<string,string>)[language],exact:true}).click();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect.poll(()=>page.evaluate(async()=>{const r=await window.verseClaw!.hostInvoke<{language:string}>({id:crypto.randomUUID(),module:"settings",action:"getAll"});return r.ok?r.data.language:null;})).toBe(language);
      await page.getByTestId("sidebar-footer-menu-trigger").click();
      await page.getByTestId("sidebar-more-task-ledger").click();
      await page.getByRole("tab", { name: labels.managed.tab, exact: true }).click();
      await page.getByLabel(labels.managed.search, { exact: true }).fill("Task page 02");
      await expect(page.getByTestId("managed-task")).toHaveCount(1);
      await expect(page.getByTestId("managed-task")).toBeInViewport();
      await expect(page.getByTestId("managed-task")).toContainText(labels.managed.claim);
      await page.screenshot({ path: info.outputPath(`filtered-task-${language}.png`) });
    }
    await writeFile(
      info.outputPath("pagination-readback.json"),
      JSON.stringify(
        {
          driven_by: "agent",
          workspaceId: created.activeWorkspaceId,
          createdIds: ids,
          pages: [50, 55],
          filtered: "Task page 02",
          corruptDatabase: "retained marked stale view, refused mutations, recovered same task",
          renderedLanguages: ["en", "zh", "ja", "ru"],
        },
        null,
        2,
      ),
    );
  } finally {
    await closeElectronApp(app);
  }
});
