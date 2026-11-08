import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  getStableWindow,
  closeElectronApp,
  installIpcMocks,
} from "./fixtures/electron";
async function host<T>(
  page: Page,
  module: string,
  action: string,
  payload: unknown = null,
): Promise<T> {
  return page.evaluate(
    async (request) => {
      const r = await window.verseClaw!.hostInvoke({ ...request, id: crypto.randomUUID() });
      if (!r.ok) throw new Error(r.error?.message);
      if (r.data && typeof r.data==='object' && 'success' in r.data && r.data.success===false) throw new Error(JSON.stringify(r.data));
      return r.data;
    },
    { module, action, payload },
  ) as Promise<T>;
}

test("normal conversation shows one task header and reveals file changes below the input", async ({
  launchElectronApp,
  homeDir,
}, info) => {
  test.setTimeout(240_000);
  const root = join(homeDir, "conversation-task");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, windowsHide: true, stdio: "pipe" });
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Missing port"));
      server.close((e) => (e ? reject(e) : resolve(address.port)));
    });
  });
  const profile = join(homeDir, "task-ui-profile");
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, "settings.json"),
    JSON.stringify({ language: "en", gatewayAutoStart: false, gatewayPort: port }),
  );
  const app = await launchElectronApp({ skipSetup: true, profileDir: profile, theme: 'light' });
  try {
    const page = await getStableWindow(app);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByTestId('chat-page')).toBeVisible();
    await expect(page.locator('.codex-composer-shell')).toBeVisible();
    await expect(page.getByTestId("session-task-dock")).toHaveCount(0);
    await expect(page.getByTestId('chat-welcome-bg')).toHaveCount(0);
    await expect(page.getByTestId('chat-welcome-watermark')).toHaveCount(0);
    await expect(page.getByTestId('composer-git-trigger')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('conversation-empty.png'), animations: 'disabled' });
    await host(page, "gateway", "start");
    await expect
      .poll(
        () =>
          host<{ gatewayReady: boolean }>(page, "gateway", "status").then((x) => x.gatewayReady),
        { timeout: 120_000 },
      )
      .toBe(true);
    const created = await host<{ activeWorkspaceId: string }>(page, "workspaces", "create", {
      name: "Quiet task project",
      rootPath: root,
      agentId: "main",
      activeSessionKey: 'agent:main:main',
    });
    await host(page,'workspaces','update',{id:created.activeWorkspaceId,activeSessionKey:'agent:main:main',sessionKey:'agent:main:main',agentId:'main',permissionMode:'fullAccess'});
    const session = await host<{ key: string; sessionId: string }>(page, "gateway", "rpc", {
      method: "sessions.create",
      params: { agentId: "main", label: "Quiet task" },
    });
    expect(session.key).toBeTruthy();
    await host(page, "workspaces", "update", {
      id: created.activeWorkspaceId,
      activeSessionKey: session.key,
      sessionKey: session.key,
      agentId: "main",
    });
    const described = await host<{ session: { sessionId: string } }>(page, "gateway", "rpc", {
      method: "sessions.describe",
      params: { key: session.key },
    });
    // Workspace setup can create repository metadata files. Freeze that baseline
    // before testing whether a later source edit reveals the changed-file chip.
    execFileSync('git', ['add', '--all'], { cwd: root, windowsHide: true, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=Agent UI Test', '-c', 'user.email=agent-ui@example.invalid',
      'commit', '--allow-empty', '-m', 'Initialize isolated conversation fixture'],
    { cwd: root, windowsHide: true, stdio: 'pipe' });
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim()).toBe('');
    await installIpcMocks(app, {
      gatewayRpcByMethod: {
        "chat.history": {
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Please fix the export and verify it.",
              timestamp: Date.now(),
            },
            {
              id: "a1",
              role: "assistant",
              content: "I will inspect the export and run its checks.",
              timestamp: Date.now() + 1,
            },
          ],
        },
      },
    });
    await page.reload();
    await page.getByTestId(`sidebar-session-${session.key}`).click();
    await expect(page.getByTestId("session-task-dock")).toHaveCount(0);
    await expect(page.getByTestId('composer-git-strip')).toHaveCount(0);
    await expect(page.getByTestId('chat-header-session-name')).toHaveText('Chat options');
    await expect(page.getByTestId('chat-header-branch')).toHaveCount(0);
    const require = createRequire(join(process.cwd(), "package.json"));
    const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
    const bundle = join(homeDir, "task-store.cjs");
    await build({
      stdin: {
        contents:
          'export * from "./shared/task-system/store.ts";export * from "./shared/task-system/identity.ts";',
        resolveDir: process.cwd(),
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
    });
    const { TaskSystemStore, resolveTaskDomain } = require(bundle);
    const owner = new TaskSystemStore(resolveTaskDomain(root));
    let started;
    try {
      started = owner.start(
        {
          contract: {
            objective: "Fix and verify the export",
            target: "src/export.ts",
            constraints: ["Preserve the existing format"],
            acceptance: [
              {
                id: "test",
                description: "Export regression checks pass",
                verification: {
                  kind: "tool-result",
                  tool: "exec",
                  command: "node test-export.cjs",
                  files: ["test-export.cjs"],
                  exitCode: 0,
                },
              },
            ],
          },
        },
        session.key,
        described.session.sessionId,
        "conversation-start",
      );
      owner.checkpoint(started.claim,{completed:['Inspect export'],nextAction:'Run checks',unresolved:[],artifacts:[]});
    } finally {
      owner.close();
    }
    const sendUpdate = () =>
      app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send("chat:runtime-event", {
            type: "tool.completed",
            sessionKey,
            runId: "task-ui-run",
            toolCallId: "start",
            name: "task_control",
          });
      }, session.key);
    await sendUpdate();
    const dock = page.getByTestId("session-task-dock");
    await expect(dock).toContainText("Fix and verify the export");
    await expect(dock).toBeInViewport();
    await expect(dock).toHaveAttribute('data-placement','header');
    const headerBox=await dock.boundingBox();const inputBox=await page.locator('.codex-composer-shell').boundingBox();
    expect(headerBox!.y).toBeLessThan(180);expect(headerBox!.y+headerBox!.height).toBeLessThan(inputBox!.y);
    await expect(page.getByText('Fix and verify the export',{exact:true})).toHaveCount(1);
    await expect(dock.getByRole('progressbar')).toHaveCount(0);
    await writeFile(join(root,'export.ts'),'export const verified = true;\n');await sendUpdate();
    const fileChip=page.getByTestId('composer-git-trigger');await expect(fileChip).toContainText('1 file changed');
    const fileBox=await fileChip.boundingBox();
    const composerBox=await page.locator('.codex-composer-shell').boundingBox();
    expect(fileBox!.y).toBeGreaterThanOrEqual(composerBox!.y+composerBox!.height);
    await expect(fileChip).not.toContainText('master');await expect(fileChip).not.toContainText('conversation-task');
    const toggle = page.getByTestId("session-task-plan").locator("button").first();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId('session-task-steps')).toContainText('Inspect export');
    await expect(page.getByTestId('session-task-steps')).toContainText('Run checks');
    await expect(page.getByText('Fix and verify the export',{exact:true})).toHaveCount(1);
    await page.screenshot({path:info.outputPath('conversation-task-expanded.png'),animations:'disabled'});
    await page.getByTestId("session-task-close").click();
    await expect(page.getByTestId("session-task-panel")).toHaveCount(0);
    await expect(page.getByTestId("session-task-reopen")).toBeVisible();
    await page.screenshot({path:info.outputPath('conversation-task-hidden.png'),animations:'disabled'});
    const current = await host<{ task: { claim: { epoch: number }; contract: { state: string } } }>(
      page,
      "taskLedger",
      "sessionTask",
      { workspaceId: created.activeWorkspaceId, sessionKey: session.key },
    );
    expect(current.task.claim.epoch).toBe(started.claim.epoch);
    expect(current.task.contract.state).toBe("doing");
    await sendUpdate();
    await expect(page.getByTestId("session-task-panel")).toHaveCount(0);
    await page.reload();
    await page.getByTestId(`sidebar-session-${session.key}`).click();
    await expect(page.getByTestId("session-task-reopen")).toBeVisible();
    await page.getByTestId("session-task-reopen").click();
    await expect(page.getByTestId("session-task-panel")).toBeVisible();
    await page.screenshot({ path: info.outputPath("conversation-task.png") });
    await page.setViewportSize({ width: 920, height: 720 });
    await expect(dock).toBeInViewport();
    await expect(page.getByTestId("session-task-close")).toBeInViewport();
    await page.screenshot({ path: info.outputPath("conversation-task-narrow.png") });
    await page.setViewportSize({width:1440,height:900});
    for (const language of ['zh','ja','ru']) {
      const labels=JSON.parse(await readFile(join(process.cwd(),'shared/i18n/locales',language,'taskLedger.json'),'utf8'));
      await page.getByTestId('sidebar-nav-settings').click();await page.getByTestId('settings-nav-general').click();await page.getByTestId('settings-language-select').click();
      await page.getByRole('option',{name:({zh:'中文',ja:'日本語',ru:'Русский'} as Record<string,string>)[language],exact:true}).click();
      await expect(page.locator('html')).toHaveAttribute('lang',language);await page.getByTestId('settings-back-button').click();
      await expect(page.getByTestId('session-task-close')).toHaveAttribute('aria-label',labels.conversation.hide);
      await expect(dock).toBeInViewport();await page.screenshot({path:info.outputPath(`conversation-task-${language}.png`)});
    }
    await writeFile(
      info.outputPath("task-ui-readback.json"),
      JSON.stringify(
        {
          driven_by: "agent",
          source:
            "Production atomic start and Main read API; controlled chat history and runtime event delivery",
          task: current.task,
          default: "collapsed",
          hiddenPersists: true,
          hidePreservesClaim: true,
          languages:['en','zh','ja','ru'],keyboardToggle:true,
          layout:'single task header above transcript; changed-file chip below composer; plain canvas',
        },
        null,
        2,
      ),
    );
  } finally {
    const page = await getStableWindow(app).catch(() => null);
    if (page) await host(page, "gateway", "stop").catch(() => {});
    await closeElectronApp(app);
  }
});
