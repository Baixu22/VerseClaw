---
lifecycleStatus: active
id: session-derivation-ui
title: Make session lineage and derived-session actions visible in Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose the existing fork, handoff, spawn, and message-level session lifecycle as a coherent Chat UI, preserving runtime ownership and the deliberately introduced Handoff first-send behavior.
touchedAreas:
  - harness/specs/tasks/session-derivation-ui.md
  - harness/specs/scenarios/session-derivation-ui.md
  - harness/specs/rules/session-derivation-ui-contract.md
  - harness/specs/guides/session-derivation-ui-design.md
  - harness/specs/tasks/autonomous-project-system.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/scenarios/autonomous-project-system.md
  - src/App.tsx
  - src/pages/Projects/**
  - src/components/task-ledger/**
  - src/components/chat/ResourceChip.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/session-buckets.ts
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/**
  - src/stores/chat/**
  - shared/chat/**
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/stores/session-activity.ts
  - src/lib/workspace-session.ts
  - src/stores/chat/runtime-send-actions.ts
  - src/lib/host-api.ts
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - shared/host-api/contract.ts
  - shared/types/session-derivation.ts
  - shared/types/session-activity.ts
  - shared/i18n/locales
  - tests/unit/**
  - tests/e2e/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - A parent conversation can reveal multiple derived sessions in its existing project/workstream grouping.
  - Users can identify and navigate between source sessions, Fork branches, Handoff sessions, and spawned workers.
  - Per-session running, waiting, completed, failed, and aborted states remain attached to the correct session.
  - Users can start a child from a specific message with a reviewable question draft that is never auto-sent.
  - Missing or malformed lineage is visible as incomplete; it is never silently shown as a root.
  - 项目名称打开显式绑定的项目负责人页面，折叠控件只整理列表；会话有可追溯的任务清单，执行准入由既有owner负责。
  - 项目和会话视图区分任务验收、运行终态和临时计划；状态、证据与资源均按scope读取，不通过全局currentSession猜归属。
residualPaths:
  - .gitignore
requiredRules:
  - identity-scope-boundary
  - contract-first-boundary
  - session-derivation-ui-contract
  - sidebar-session-row-controls
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - ui-motion-material-system
  - disk-temp-policy
requiredProfiles:
  - fast
  - e2e
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-workstreams.test.ts tests/unit/session-folder-tree.test.tsx tests/unit/session-derivation-lineage.test.ts
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-session-fork.spec.ts tests/e2e/chat-session-handoff.spec.ts tests/e2e/session-derivation-ui.spec.ts tests/e2e/project-agent-entry.spec.ts
plannedTests:
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/project-agent-entry.spec.ts
acceptance:
  - Renderer preserves the existing derivation fields, including spawnedBy, and renders relationships from the read-only session derivation projection.
  - The shared classifier correctly distinguishes Spawn rows carrying both parentSessionKey and spawnedBy; contradictory facts remain diagnostic.
  - The sidebar supports multiple direct children, bounded visual depth, keyboard disclosure, and navigation without changing workspace/workstream grouping or the existing row action contract.
  - Source breadcrumbs and derived-session navigation cover Fork, Handoff, and Spawn with distinct labels and destinations; time sorting stays flat and cross-workstream sessions are not refiled or duplicated.
  - Session activity/status remains per-session; child state summaries never overwrite parent state.
  - “Ask in a new session” uses the selected user message's preceding assistant ancestor, opens the child with an editable question draft, and sends nothing until explicit user action.
  - Handoff copy, specification and test names agree with its deliberate create-and-send behavior; failed/unknown first delivery preserves a recoverable child draft and does not silently retry.
  - Handoff creates persistent runtime parent linkage through the existing owner; Task Ledger remains task/depth metadata and never becomes a parallel UI lineage tree.
  - Stable Handoff creation and first-send identities survive lost responses and application restart; reconciliation reuses the child and original send key, while an unprovable send remains unknown.
  - Spawn admission, execution, reporting, acceptance and parent continuation show separate truthful states; a text-only model suggestion cannot perform a hidden session mutation.
  - Existing stop, pause/resume, archive/undo, restore, delete, compact and checkpoint-restore flows retain session/generation binding and owner-supported controls without implicit child cascading.
  - Missing-parent, cycle, bound-exceeded, failure, and active-run states have deterministic visible outcomes and no orphan/empty replacement session is fabricated.
  - No new lineage table, relation type, store writer, direct renderer IPC, or direct Gateway request is introduced.
  - All visible copy is covered in en/zh/ja/ru and Electron E2E covers the lifecycle, keyboard, and responsive states with agent-driven evidence.
  - U1在自治对象合同A1后接入项目和任务引用只读投影；U2在强任务绑定A4后接入项目负责人入口和任务清单，不新增任务或谱系writer。
  - U3显示Fork/Handoff任务继承边界且不复制写claim或lease；U4按项目/会话展示任务驱动的委派与验收回交；U5明确任务、会话与资源控制效果。
  - U6验收项目入口与任务会话体验，完整自主规划、跨项目执行和工具恢复由自治规划V2另行验收，不扩大或混同两种完成声明。
docs:
  required: true
  readmeTranslations: required
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - harness/specs/guides/session-derivation-ui-design.md
---

# 会话 UI 设计依据与边界

Codex、Claude 的资料用于参考工作区与会话的组织、并行任务状态和独立分支概念，不作为 ClawX 的像素或品牌规范。消息级分支以本项目 runtime 的实际 leaf 语义为准；Claude Projects 与 Cowork Dispatch 也属于各自不同的产品场景。

- Codex app 与 Projects：<https://developers.openai.com/codex/app/>；worktrees：<https://developers.openai.com/codex/app/worktrees>；subagents：<https://developers.openai.com/codex/subagents>
- Codex CLI `/fork`：<https://developers.openai.com/codex/cli/slash-commands>。它不证明桌面任意消息点分叉或侧栏父子树。
- Claude Projects：<https://support.claude.com/en/articles/9517075-what-are-projects>
- Claude Cowork Dispatch：<https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork>

ClawX 实现必须以 `session-derivation-ui-contract` 为约束，并复用现有 sidebar、Chat header、session activity 与 composer 行为。视觉保持 ClawX 当前中性表面、30px 会话行与克制状态色；不复刻 Codex 或 Claude 品牌元素。

## Staged delivery

1. **单一关系读模型**：保留 `spawnedBy`，共用现有关系分类，区分缺失/循环/截断、可见与不可见父项；不做 N+1 activity polling。
2. **父子导航和状态**：项目内按需展开多子会话、完整来源链、返回父会话；时间视图平铺，草稿/焦点与工作线归属保持。
3. **Fork 与续接**：消息级问题草稿、真实分叉边界、Handoff 明确创建并发送；先接齐既有 runtime owner 的持久 parent，再以稳定创建/发送标识恢复首轮失败、未知及进程重启，不重复创建。允许对现有 owner/持久层和 Host 契约作必要的窄扩展，不另建关系权威。
4. **Spawn 与跨会话交付**：沿现有委派/活动/回执界面显示 admission→运行→报告→父会话续接；可访问 child transcript 与真实不可用状态。
5. **其余生命周期控制**：核查并接齐现有 Stop、暂停/继续、归档/还原/删除、compact/checkpoint restore；同逻辑会话事件不画成子会话。
6. **整链验收**：四语、键盘、窄窗口、明暗主题、动效、Electron 旅程与 README 同步。每个 UI 实现阶段自己交付 E2E，不把测试全推到最后。

本轮只登记设计和执行合同，未修改产品 UI、未运行功能验收。上面新测试是待交付要求，不表示文件已经存在或已通过。每阶段开始前按其写集建立窄 task spec，运行 context/validate/run --dry-run；本任务是 umbrella 合同。

2026-11-02增补：用户授权将0657–0662纳入完整自治规划，并直接调整其中UI。增量以autonomous-project-system-plan为准：A1→U1，A4→U2；U1–U6原顺序和旧验收保留。项目负责人页面先复用既有协调器与任务owner，自动拆解/派发不塞入U2，由P1/P2负责。新增行为范围与历史骨架“零行为”任务分开，不改历史验收结论。

Task Forest 以保存时最新图状态排队：本支线至多一个 ready 叶子，其余实施叶子按依赖保持 proposed；不变更其他会话正在执行的节点。完整 UI 验收完成前，规划和静态 validate 均不构成功能通过证据。
