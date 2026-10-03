# 前端渲染组件修复 · 验收报告

> 日期：2026-08-11 · 分支：`codex/ui-polish` @ `2bce463c5`（工作树未提交）
> 审计底稿：[frontend-render-audit-20260810.md](frontend-render-audit-20260810.md) · 批准计划：`.claude/plans/mock-peaceful-marshmallow.md`
> 走查场景清单：[docs/dev/mock-render-scenarios.md](../docs/dev/mock-render-scenarios.md)
>
> 过程产物归档说明（2026-10-03）：本文保留原轮次事实。`reports/assets/frontend-render-fix-20260811/`
> 与 `scripts/capture-render-evidence.cjs` 是本地历史归档，不再作为当前检出的必备输入或执行入口。
> 下文命令和结果不代表当前 HEAD 已通过验收；当前回归应使用维护中的测试，勿为清理重新执行旧采图脚本。

## 结论

**验收通过。** F1–F10 全部闭环（9 修复 + 1 明确保留），三层验收全绿：

| 层 | 内容 | 结果 |
|---|---|---|
| 1 · 单测 | `verify:render` 前半：4 个新测试文件 37 用例（可达性对偶面 + 归属 + 文件夹树 + 渲染收敛） | ✅ 全绿 |
| 2 · Playwright web | `playwright.web.config.ts` + `tests/e2e-web/` 8 spec 11 用例（mock 场景驱动真实浏览器） | ✅ 11/11 |
| 3 · 走查 | 9 个 mock 场景逐个实测 + 7 张截图存证（本目录 `assets/frontend-render-fix-20260811/`） | ✅ |

回归判定（clean detached worktree，对比父提交 `2bce463c5`，同机同命令）：

| 树 | 失败文件 | 失败用例 |
|---|---|---|
| 基线 = HEAD | 29 | 124 |
| 候选 = HEAD + 本线改动 | 23 | 84 |

**新增失败：0。** 本线顺带修复 6 个 HEAD 上就红的文件（`chat-message` / `chat-leading-orphan-tools` / `chat-history-reply-while-sending` / `chat-page-execution-graph` / `chat-tool-card-suppression` / `startup-loading-experience`）。剩余 23 个失败文件全部是 HEAD 预存债（ipaddr.js 解析、verseshell、uas 系列等，与渲染线无关）。原始日志见 `assets/frontend-render-fix-20260811/*.log`。

## 门禁与命令

```bash
pnpm verify:render        # = 4 个单测文件 + pnpm test:e2e:web，本次 exit 0
```

- `test:e2e:web` = `playwright test --config playwright.web.config.ts`（自起 `pnpm dev:web`:5273，可并行，无需 build:vite）。
- 增量 lint/typecheck：`tsc --noEmit -p tsconfig.web.json` exit 0；`eslint playwright.web.config.ts tests/e2e-web/` exit 0。
- web e2e 只锁纯渲染语义；涉真实主机能力（文件/git/终端）仍归 Electron e2e。

## F1–F10 逐条

| 发现 | 怎么验的 | 结论 | 证据 |
|---|---|---|---|
| **F1 (P0)** tool_call 形态的 24 种 Tool UI 卡片在运行段不可达 | 共享投影 `message-render-projection.ts` 成为行可见性唯一真源；围栏/工具调用双通路对照 | 修复 | 单测 `chat-render-reachability`（19 例「该出现的必须出现」）；e2e `render-toolcall-cards`（双通路同卡）、`render-ask-blocking`（仅 question_flow、无最终回复时问题卡可见可操作，插入答复落回 composer）；截图 06 |
| **F2 (P1)** 嵌套工作组重命名/删除误伤父级 | 回调按 folderId 派发；mock fixture 真实改写内存态后断言父链 | 修复 | 单测 `session-folder-tree`；e2e `sidebar-folder-tree`（改名 grandchild → 两级父名不变；删 grandchild → 父/根/旁系仍在） |
| **F3 (P2)** 深层会话移不出工作组 | 移动菜单上移到全部深度并 portal 化 | 修复 | e2e `sidebar-folder-tree`（第 3 层会话 hover→移动→无工作组，行仍存活于未归组）；截图 07（菜单不被裁切） |
| **F4 (P1)** 待批准跨轮静默消失 | `selectPendingApprovals` 不再按 runId 过滤；按卡归属+最新兜底；**无任何卡时独立兜底面** | 修复 | 单测 `run-approval-attribution`、`pending-run-approvals`；e2e `render-approval-carryover`（第 1 轮未决→第 2 轮回复落地后卡仍在、恰 1 张、批准键可用）。注：carryover 属兜底面路径（run 结束无卡），符合设计 |
| **F5 (P2)** 折叠把阻塞交互藏起来 | 待批准强制展开 + 折叠头内容角标 | 修复 | e2e `render-no-duplicates`（审批 pending 时 `chat-turn-summary-details` 无点击即可见）、`render-plan-only`（折叠头 `3 步计划` 角标）；截图 01/03 |
| **F6 (P2)** thinking 三通路全关 | 历史路径走真实 thinking 块回退，流式走 `reasoningOverride`；BranchPicker/ToolFallbackCard 删除（找回锚点 `ac5a06830` 注于 `model.ts`） | 修复 | 单测 `assistant-render-model`；e2e `render-thinking`（流式 shimmer + 思考文本可见 → 结束折叠为「已思考」→ 可再展开）；截图 04/05 |
| **F7 (P2)** 侧边栏逐 token 重渲染 | handler useCallback + sessionStatuses 按 signature 摘要 memo | 修复 | 单测 `sidebar-render-containment`（render 计数不随事件数增长） |
| **F8a** 文件 chip 与内联 diff 双呈现 | `chipFilesByRun` = filesByRun 减 diff 已 own 的 | 修复 | 单测 `generated-files` |
| **F8b** 命令串图行/终端卡重复 | 产出 `command.output` 的 `tool.started` 行一并提升 | 修复 | 单测 `run-surface-promotion`；e2e `render-no-duplicates`（settled 后终端卡恰 1 张，图内无同命令行、无 Approval 行） |
| **F8c** 审批双卡 | `MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES`（approval-card 的 owner 是 host 审批面） | 修复 | 对偶单测 `chat-tool-card-suppression` + `chat-render-reachability` 同时绿；e2e 审批卡计数==1 |
| **F9 (P3)** 孤儿组件 | 逐个核对引用与 host 端接线 | 部分删除 + 明确保留 | `StatusBadge`/`dot-matrix` 已删；**Topics 保留**（host API 完整，是未接线功能非死码）；`ComposerGitStrip` 等有测试的保留 |
| **F10 (P3)** 空执行图壳 | `steps.length===0 && !(active && !suppressThinking)` → null；连删 `TaskStep` 的 `'thinking'` 死变体 | 修复 | 单测 `chat-page-execution-graph`；e2e `render-plan-only`（`chat-execution-graph` 计数 0） |

## 本窗口新发现并修复

1. **turnSummary.badge 复数键破坏 i18n 奇偶性**：四语各按语言习惯写了 `_one/_other/_few/_many` 后缀，`i18n-locale-parity.test.ts` 要求四语叶键逐字相同 → clean-worktree 对比抓出 3 例新失败。已按仓库既有约定（`workgroups.sessionCount` 模式）压平为单键 `{{count}}` 形态，四语同步；压平后角标渲染经 e2e 复验（「3 步计划」可见）。**这正是 clean-worktree 对比的价值**——脏主树上这两个仓库级契约测试从未被跑到。
2. **page-shell.tsx 标题样式改动违反设计契约测试**（`fakecoding-design-system.test.ts` 逐字断言 `text-[28px] font-normal…`）。该改动不属于渲染线（不在交接 §二 任何修复表内），已**排除出本线提交清单**，原样留在工作树，另立任务交 ui-polish 线裁决（回退或正式改契约）。

## 提交清单（逐文件挑，禁 `git add -A`）

以下 62 项 = 本线全部落盘物。`src/components/ui/page-shell.tsx` **不在其中**（见上）；`pnpm-lock.yaml`、harness/ 删除、`.tmp-*`、`design-verify.html`、`uv-*.zip` 均非本线。

<details><summary>展开</summary>

```
package.json
playwright.web.config.ts
vite.web.config.ts
shared/i18n/locales/{en,zh,ja,ru}/chat.json
src/components/assistant-render/{AssistantRender,TurnSummaryCard,ThinkingReasoning}.tsx
src/components/assistant-render/model.ts
src/components/file-preview/MonacoDiffViewer.tsx
src/components/layout/{SessionFolderTree,Sidebar}.tsx
src/components/loading/RouteLoadingShell.tsx
src/components/tool-ui/{agent-interactions,plan-view,RunTerminalSurfaces}.tsx
src/components/tool-ui/run-surfaces.ts
src/components/tool-ui/weather-widget/            (整目录)
src/lib/{mock-host-bridge,mock-run-script,install-mock-host-bridge}.ts
src/main.tsx
src/pages/Chat/{ChatMessage,ExecutionGraphCard}.tsx
src/pages/Chat/{execution-projection,message-utils,task-visualization,message-render-projection,run-surface-promotion,use-run-approvals}.ts
src/pages/Chat/index.tsx
src/pages/{Cron,Inbox,Knowledge}/index.tsx
tests/setup.ts
tests/e2e/{chat-assistant-rendering-visual,knowledge-ux-cdp}.spec.ts
tests/e2e-web/                                     (整目录，8 spec + helpers)
tests/unit/{assistant-render-model,tool-ui-run-surfaces,run-surface-promotion,run-approval-attribution,tool-ui-update-plan}.test.ts
tests/unit/{chat-history-reply-while-sending,chat-leading-orphan-tools,chat-message,chat-page-execution-graph,chat-tool-card-suppression,chat-render-reachability,session-folder-tree,sidebar-render-containment,knowledge-page,pending-run-approvals,tool-ui-weather}.test.tsx
docs/dev/mock-render-scenarios.md
reports/frontend-render-audit-20260810.md
reports/frontend-render-fix-verification-20260811.md
reports/assets/frontend-render-fix-20260811/       (7 png + 4 log)
scripts/capture-render-evidence.cjs
删除：tests/e2e/tmp-conversation-shot.spec.ts（自述临时文件，已删）
```

</details>

## 遗留（非阻塞）

- **Electron 视觉快照重建**：`chat-assistant-rendering-visual.spec.ts` 的 3 张 PNG 基线已删（BranchPicker/ToolFallback 移除后 DOM 必变），下次跑重型 e2e 带 `--update-snapshots`。
- **page-shell 契约冲突**：已排除出本线，待 ui-polish 线裁决（已立任务）。
- 预存不修：`index.tsx:3667` setState-in-effect lint error（HEAD 就有）；`tsgo:prod` 存量 266 错；HEAD 预存的 23 个失败测试文件（清单见 `assets/.../vitest-cand2-main.log`）。
- zh 局部 `assistantRender.reasoning.title` 值为 mojibake `"????"`（HEAD 预存、无消费者，未动）。
