---
lifecycleStatus: active
id: session-collaboration-a2
title: A2 扩展会话发现与共用详情查询
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 2276f853907b2479d62d671cd70e94da88da6396
intent: 消费 A1 身份与只读 owner 合同，让 UI 和现有会话工具共用有界、带来源的发现与详情查询。
touchedAreas:
  - src/components/agents/SessionCollaborationPanel.tsx
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/e2e/session-collaboration-overview.spec.ts
  - shared/types/session-activity.ts
  - shared/types/session-collaboration.ts
  - shared/types/session-collaboration-material.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/src/config/sessions/combined-store-gateway.ts
  - openclaw_runtime/src/agents/session-task-scope.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tools/sessions-list-tool.ts
  - openclaw_runtime/src/agents/tools/session-status-tool.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-query.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-read-model.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-query.ts
  - electron/services/session-activity-api.ts
  - src/lib/host-api.ts
  - src/lib/session-read-model.ts
  - tests/unit/session-collaboration-query.test.ts
  - tests/unit/session-summary-bounded-read.test.ts
  - tests/unit/host-api-facade.test.ts
  - harness/specs/tasks/session-collaboration-a2.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/fixtures/session-collaboration-center/A2/**
  - harness/specs/fixtures/session-collaboration-center/A2-development-20261128/**
  - docs/modules/sessions.md
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - UI typed facade 和 agent 的 sessions_list、只读 session_status 对相同输入返回相同范围、任务、动作和来源事实。
  - 查询按工作区、会话和目标过滤，并以稳定游标、字段选择和显式详情入口控制读取量。
  - 真实空闲、空任务、未查询、不可读取、旧观测和未知身份分别表达。
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - durable-task-system-boundary
  - contract-first-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-panel.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/session-collaboration-query.test.ts tests/unit/session-summary-bounded-read.test.ts tests/unit/session-collaboration-identity.test.ts tests/unit/host-api-facade.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run build:runtime
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-a2.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-a2.md --dry-run
  - git diff --check 2276f853907b2479d62d671cd70e94da88da6396 HEAD
  - git diff --check
acceptance:
  - 现有 sessions_list 与只读 session_status 可取得目标、任务引用、实际动作、状态、来源和详细查询入口。
  - 分页、过滤、字段选择和详情加载有明确界限；列表查询不扫描全部会话完整 transcript。
  - UI 与 agent 对同一请求得到一致身份与事实；受现有 sessions visibility/A2A/工作区读取策略约束。
  - 空任务、不可读取、过期观测和真实空闲分别表达；跨项目发现不隐式切换活动工作区。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
---
# A2 读取合同

前置 TF-0919 已 done/100；本叶属于 TF-0913 / TF-0664。Task Forest 唯一状态源继续为 D:/ClawX，通过 CLI --workspace D:/ClawX 回读；源码、测试与提交在当前源码工作树。

2026-11-28 从 E4 合并主线恢复 A2 权限竞态补丁，执行定向回归与星驰开发验收。完整类型、构建、CI和桌面实跑沿用延期安排。

共享材料种类由 shared 的常量和派生类型定义；shared 不导入 Runtime 的黑板类型。共用读取 facade 的边界回归同时验证这条依赖方向。

扩展 typed `sessionActivity.query`，沿既有 Main-owned Gateway WebSocket 和 `session.activitySnapshot` 路由提供一个共用查询。输入绑定原 requester scope；目标详情携带显式目标 scope，工作区过滤使用既有 workspace/project 映射。工具的发送者 key/generation 来自现有运行上下文，模型参数不能冒充发送者或变更读取资格。

列表使用原 SessionStore 的只读 metadata snapshot；TaskSystem / execution-domain 按根目录在单次查询内复用只读连接。字段选择包含目标、任务引用、ScopedRun、实际工具/进程动作、真实来源和执行域；未选字段返回 not_read。目标文本有长度上限，原任务 digest/revision 与 A1 详情引用保留。

单页最多 50 个结果，单次最多检查 100 个可见候选；默认页长 20。游标绑定 requester、过滤条件和原 metadata 身份，来源改变或 reset 返回 stale。搜索包含会话 metadata 与原 TaskSystem 目标；无法核验的目标保留 unknown，不把读取失败当作已确认的无匹配结果。查询和详情均不读取完整 transcript，不调用模型或改变活动工作区。

实际动作消费原 session-task effect request 与 bash process owner。工具动作的 ScopedRun 复制原 Main 准入结果；尚未准入时保留 unknown，同 key/generation 的准入工作区或项目不符时返回 unavailable/scope-mismatch，不用当前行重新构造 run。已确认工具/进程按原 session/generation/run 归因；运行存在而动作未观测时保留 unknown，缺少 owner 身份不借当前运行补签。已核验的 run ready 使行保持 running；动作 ready 必须包含已观测动作，ready 与空数组的组合由 Main、UI 和工具共同拒绝。任务引用保持 TaskSystem writer/observer 身份，不据此建立会话血缘。

复用既有 session visibility、A2A allow 与 sandbox 读取策略，先筛选可见会话，再读取目标、任务和动作。只读 session_status 使用显式 readOnly 模式，拒绝同时传入模型修改；原状态工具的模型配置入口继续由既有 owner 执行。

发现与详情在最后一次异步来源读取后再次消费当前配置的 visibility、A2A allow 与 sandbox 策略。已读取候选的访问资格撤销时返回 unavailable/not-visible，清除事实、分页游标和读取计数。正反用例覆盖任务来源读取期间的三种撤销，以及最终 metadata await 期间的撤销；Main、UI、sessions_list 和只读 session_status 返回一致拒绝。

Main、UI 和现有工具共同拒绝重复会话行、未知原因码、带观测时间或缺失来源原因的 not_read，以及仍有未知匹配却声称 empty 的页。unavailable/stale 页带明确原因并清除分页游标与读取计数。回复中的 requester、当前会话行或详情引用换代返回 generation-changed；同代工作区、项目、key 或运行范围不符返回 scope-mismatch。

原 Workspace/Gateway owner 的读取失败在 Main、UI 与两个会话工具返回 unavailable/owner-unavailable。读取已返回但 Query 页缺失、为空值或 UI success 信封不成立时返回 unknown/protocol-unverified，保留已解析的 requester，清除事实与分页。输入与当前 requester 身份仍在调用前验证，错误参数不能被改写成来源不可用。

正反用例覆盖两个独立会话与子代理、跨工作区过滤、真实空任务与空闲、来源缺失、旧 generation/游标、读取中 reset、字段未选、分页上限、隐藏会话及 A2A/sandbox 拒绝。补充缺 owner 的搜索、旧 schema 单次连接尝试、Unicode 目标截断、原在途请求的待准入/结清、同 key/generation 的异工作区准入、只读 run 副本隔离，以及 Main/UI/工具对异常来源、范围和字段的一致拒绝。记录查询前后 owner 内容和数据库哈希，检查 metadata 读取次数、连接复用和 transcript 字节读取为 0。证据区分原 SQLite / registry / native Git 与 fixture adapter，全部 driven_by: agent；首轮失败及原始回执放 D:/tmp。

满足四项验收后提交实现、规格和精选证据，按匹配 base_graph_hash 收口 TF-0920，validate、既有流式完整历史 export 与回读后留下 A3 续接说明。回退撤回本叶查询挂接，保留原会话、任务、运行和用户数据。
