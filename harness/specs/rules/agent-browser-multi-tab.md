---
id: agent-browser-multi-tab
title: Agent Browser Multi-tab Control
severity: error
---

# Rule: Agent Browser 多标签页受控

> 抄写自 browser-ai-assistant-master/AGENTS.md §15「浏览器自动化控制规划」第 808-826 行，
> 适配 Electron BrowserWindow 多窗口 tab 模式。

## 适用范围

`packages/versebrowser/src/engine/browser-control/tab-manager.ts`、
`packages/versebrowser/src/engine/service.ts` 中的 newPage/listPages/selectPage/closePage/navigatePage 方法、
`shared/host-api/contract.ts` 中 `agentBrowser` 命名空间的 5 个 tab 动作。

## 硬性规则

### R1：controlledTabIds 后台列表

多标签页控制只在 background（Main 进程）维护 `pages: Map<pageId, AgentBrowserTabEntry>` 列表。
不得创建、重命名、复用或删除用户可见的浏览器原生标签组 UI。
浏览器控制不得产生用户可见的标签组副作用。

### R2：初始化受控列表

启用浏览器控制（session.open）时，主窗口自动注册为 pageId="0" 的首页。
后续通过 `newPage` 创建的页面继续加入此列表。
受限页面（`chrome://`、`edge://`、`about:`、`chrome-extension://`、`view-source:`、
`app://`、`clawx://`、`file://`、Chrome Web Store）不得加入受控列表。

### R3：导航 URL 限制

`navigatePage` 和 `newPage` 只能导航到有效的 `http:` / `https:` 普通网页。
必须继续拒绝 `chrome://`、`edge://`、`about:`、`chrome-extension://`、`view-source:`
和 Chrome Web Store。

### R4：导航后清理旧 UID

导航、新页面、页面切换或关闭当前受控页后，必须清理旧快照 UID。
模型系统提示必须声明旧 UID 失效，模型必须重新 `takeSnapshot` 后再继续。
切换页面时由 service 层调用 `snapshotManager.clearSnapshotCache()` 并重建 control state。

### R5：稳定性等待

浏览器控制动作执行应 best-effort 等待可能的导航和短暂 DOM 稳定，
避免在 click/fill/keypress 触发跳转后立即读取陈旧页面状态。
稳定性等待失败不得无限阻塞聊天流。
动作工具的 `includeSnapshot` 只能在等待完成后读取快照。

### R6：closePage 处理

`closePage` 主动关闭当前受控页时，必须正确处理 debugger detach 事件——
不得将工具发起的迁移误判为用户取消。
关闭前应计算剩余受控页面，关闭后切换接管。
最后一个标签页不得通过 `closePage` 关闭，需使用 session `close`。

### R7：JS 弹窗处理

遇到 JS 弹窗（`alert`、`confirm`、`prompt`、`beforeunload`）时，
只等待用户手动确认/取消/输入，不得添加 AI 自动处理工具。
最长等待 60000ms；超时必须返回中文工具错误。
弹窗关闭结果只归一化为"用户已确认"、"用户已取消"或"用户已确认并输入提示文本"。
不得尝试跨浏览器识别 yes/no/confirm/cancel 按钮文本，不得编造用户选择。

### R8：CLI 引擎限制

CLI 引擎（`agent-browser-cli`）不支持多 tab。
所有 5 个 tab 动作（newPage/listPages/selectPage/closePage/navigatePage）
在 CLI 引擎下必须返回明确的错误提示，不得静默失败。

### R9：回归测试覆盖

修改多标签页控制链时，必须覆盖以下回归测试：
- 工具 schema 验证
- 受控列表初始化
- `newPage` 添加到列表
- `list/select/close` 列表边界
- 受限 URL 拒绝
- 导航历史
- 旧 UID 失效
- JS 弹窗等待

## 验证

- `pnpm contract:check` 必须通过（contract.ts 与 host-api.ts 与 agent-browser-api.ts 对齐）
- `pnpm run typecheck:node` 必须通过
- `packages/versebrowser/tests/agent-browser-tab-manager.test.ts` 必须通过
- `pnpm --dir packages/versebrowser exec vitest run tests/agent-browser-tab-manager.test.ts` 全量 tab 回归无破坏
