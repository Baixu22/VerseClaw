# FakeCoding UI 迁移交接（2026-07-31，TF-0024 完成）

你将接手持续进行的 UI 与信息架构迁移。不要重开已确认决策；若交接与工作区冲突，以可验证证据为准。

## 【工作目录】

`C:\Users\27933\Desktop\clawx\ClawX-ui-polish`

## 【用户目标】

把 Verse Claw 迁移为 FakeCoding 式克制工作界面，同时保留 Cron、Remote Tasks、Browser、Review、Task Ledger、ClawGraph 与 Knowledge 的真实能力，并按使用上下文重新归位入口。

## 【必须遵守的要求】

- 一次只推进一个 UI ready 节点；一级侧栏保持“新任务 / 收件箱 / 已安排 / 知识”。
- 不改 Host API、Gateway、后端模型或 Browser 安全策略，除非新节点有明确授权与 Harness spec。
- 保留未提交 Cron 修改、`?uiVersion=legacy`、`.tmp-ui-compose-verification/` 和 `uv-x86_64-pc-windows-msvc.zip`。
- 新文案覆盖 `en/zh/ja/ru`，可见流程配 Electron E2E；不创建 commit、branch、push 或 PR。

## 【已确认事实与决策】

- [verified] `TF-0024` 已通过提案 `TFP-tf0024-closeout-20260731` 置为 `done/100%`；`TF-0021` 继续 `in_progress`。
- [verified] `TF-0025` 当前为 `proposed`，依赖已满足且导出中 `ready=true`；`TF-0026`、`TF-0027` 仍等待串行依赖。
- [verified] `已安排` 用 renderer `ScheduledItem` 投影 Cron 与监督式 Browser Runs，不合并两类后端模型或状态真源。
- [verified] Browser Profile/Vault 已归入 `Settings > Browser`；桌面 Settings Sidebar 使用 FakeCoding 的 `browser` SVG，兼容 Drawer 也有同一路由。
- [verified] 旧 `/browser` 与底部 `...` 菜单仍为兼容入口；实时 Browser Session 进入 Chat workspace 尚未实现，属于 `TF-0025`。
- [verified] 960px 下详情替换列表；1280/960 Light/Dark 及 Browser Settings 截图无横向溢出、文字断裂、控件重叠或重复主操作。
- [unverified] `.agent-workbench/task-forest/config.json` 与导出内的 `workspace_path` 仍记录历史路径 `C:\Users\27933\Desktop\clawx\ClawX`，而 CLI 本轮目标是当前 `ClawX-ui-polish`；不要手改 Task Forest 文件，后续应先确认是否需要通过受支持的迁移方式纠正。

## 【任务森林状态】

- 相关全局目标：`TF-0021 FakeCoding 设计体系与产品信息架构迁移`，状态 `in_progress`。
- 已完成：`TF-0022` 设计系统与应用壳、`TF-0023` 四入口与 Inbox、`TF-0024` 已安排与 Browser 任务归位。
- 当前唯一 UI ready 节点：`TF-0025 会话 Browser/Review 与工作区深层入口`。
- 后续串行：`TF-0025 -> TF-0026 Knowledge -> TF-0027 次级页面与 legacy 收尾`。
- HTML：`.agent-workbench/task-forest/exports/task-forest.html`；本轮 CLI `validate` 与 `export` 已通过。

## 【已完成】

- `ScheduledItem` 已统一投影 `cron-job | browser-task`；来源失败隔离，Browser 动作后同步刷新 Scheduled 与 Inbox。
- 已安排页已保留真实 Cron 全动作、Browser 决策与详情、960px 单视图；Settings Browser 已保留 Profile/Vault 且密码不回显。
- 已补 Harness task、store 单测、Electron E2E、四语言文案、三份 README，以及桌面 FakeCoding SVG/兼容 Drawer 入口。

## 【验证结果】

- [verified] Harness、i18n、聚焦 ESLint、typecheck、build:vite 全部通过；Vitest 13/13。
- [verified] 两个相关 E2E 直接通过；Cron automation 组合运行仅 teardown 超时，单独重跑 1/1 通过。
- [verified] `test-results/fakecoding-scheduled-brows-3c783-nd-manages-Browser-settings/` 的 5 张最终截图已人工检查。

## 【未完成 / 待验证】

- `TF-0025` 尚未启动：Chat Browser/Review 标签、`openWorkspacePanel(intent)`、Task Ledger/ClawGraph 会话摘要仍待实现。
- Task Forest 历史 `workspace_path` 与当前目录不一致，后续只通过受支持 CLI 方式处理。

## 【关键文件】

`harness/specs/tasks/fakecoding-scheduled-browser-runs.md`、`src/stores/scheduled.ts`、`src/pages/Cron/`、`src/components/settings/BrowserSettingsPanel.tsx`、`src/pages/Settings/SettingsSidebar.tsx`、`tests/e2e/fakecoding-scheduled-browser-runs.spec.ts`

## 【不要重复 / 不要做】

- 不重做或回滚 `TF-0022..0024`；Remote Tasks 继续归属 Inbox。
- 不在 `TF-0025` 中顺手收敛 Knowledge、移除 legacy 或宣称 Browser 无监督/私网开放。
- 不直接编辑 `.agent-workbench/task-forest/`，状态变更继续走 proposal CLI。

## 【下一步】

1. 用户继续后，为 `TF-0025` 保存并确认 start proposal，只启动这一项。
2. 先运行对应 Harness context；复核现有 `work-context-bar` 回归残留、Chat 工作区标签结构和 `Review Center` / Agent Browser 的真实能力边界。
3. 实现统一 `openWorkspacePanel(intent)`，把 Browser Session 与 Review 的 `Changes / AI Review / Pull Requests` 归入会话工作区，并从会话摘要/workspace 菜单提供 Task Ledger 与 ClawGraph 深层入口。
4. 保留 `/browser`、`/code-review`、`/task-ledger`、`/clawgraph` 兼容路径，完成四语言、单测、Electron E2E、1280/960 Light/Dark 与 Task Forest 收尾后，再进入 `TF-0026`。

Mode: balanced. Privacy: local. Sources: current conversation, Task Forest exports, workspace files, tests, build output, and screenshot evidence.

## TF-0025 收尾状态（2026-08-01）
- [verified] Chat 工作区已收敛为 `Review / Terminal / Browser / Files / Artifacts / Audit` 六个可见标签；Changes 归入 Review，Preview 归入 Files。
- [verified] Browser Preview/Live、Terminal bottom/side、Files 窄屏单视图和 Review 子视图均复用真实 renderer-to-Main 能力；兼容 `/browser`、`/code-review` 路由保持可用。
- [verified] `pnpm harness validate --spec harness/specs/tasks/fakecoding-workspace-convergence.md`、`pnpm run typecheck`、`pnpm run build:vite` 和 Browser/Terminal/Git 工作区 E2E（5/5）通过。
- [verified] 已保存 TF-0025 closeout proposal，尚未直接 apply done 状态；Knowledge 继续留给 TF-0026，legacy 回滚继续保留。
