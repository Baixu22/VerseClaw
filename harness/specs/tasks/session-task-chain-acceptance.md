---
lifecycleStatus: active
id: session-task-chain-acceptance
title: Verify the complete session and task chain
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 0fa9d0337
intent: Verify the user-selected A4 and U1–U6 chain on one candidate, including
  actual Gateway effects, restart reconciliation, UI journeys and scoped
  lifecycle controls.
ownedPaths: &a1
  - .gitignore
  - README.ja-JP.md
  - README.md
  - README.ru-RU.md
  - README.zh-CN.md
  - docs/dev/session-lifecycle-control-matrix.md
  - docs/modules/llm-and-models.md
  - docs/modules/multi-agent-and-tasks.md
  - docs/modules/sessions.md
  - harness/specs/rules/session-derivation-ui-contract.md
  - electron/gateway/process-launcher.ts
  - electron/gateway/session-task-scope-bridge.ts
  - electron/gateway/ws-client.ts
  - electron/main/ipc-handlers.ts
  - electron/services/chat-api.ts
  - electron/services/cron-api.ts
  - electron/services/gateway-api.ts
  - electron/services/git-api.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/services/providers/provider-store.ts
  - electron/services/session-activity-api.ts
  - electron/services/session-delegation-admission.ts
  - electron/services/sessions-api.ts
  - electron/services/task-ledger-service.ts
  - electron/services/task-system-service.ts
  - electron/services/workspaces-api.ts
  - electron/utils/openclaw-auth.ts
  - harness/specs/fixtures/session-task-chain/**
  - harness/specs/fixtures/session-task-scope-admission/**
  - harness/specs/fixtures/session-task-scope-derivation/**
  - harness/specs/guides/session-derivation-ui-design.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/scenarios/session-derivation-ui.md
  - harness/specs/tasks/chat-session-handoff-mvp.md
  - harness/specs/tasks/session-delegation-status.md
  - harness/specs/tasks/session-family-navigation.md
  - harness/specs/tasks/session-family-read-model.md
  - harness/specs/tasks/session-handoff-recovery.md
  - harness/specs/tasks/session-lifecycle-controls.md
  - harness/specs/tasks/session-task-chain-acceptance.md
  - harness/specs/tasks/session-task-scope-admission.md
  - harness/specs/tasks/session-task-scope-completion.md
  - harness/specs/tasks/session-task-scope-derivation.md
  - openclaw_runtime/packages/gateway-protocol/src/client-info.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/session-task-scope.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/subagent-registry-run-manager.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/orchestrator-write-set-plan.test.ts
  - openclaw_runtime/src/agents/tool-mutation.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run-state.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/runs.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/runs.task-scope.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/cron/isolated-agent/run-executor.ts
  - openclaw_runtime/src/cron/isolated-agent/run-runid-canonical.test.ts
  - openclaw_runtime/src/cron/isolated-agent/run.test-harness.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-memory.ts
  - openclaw_runtime/src/auto-reply/reply/reply-run-registry.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-broadcast.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-task-scope.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.read.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.send-permit-lifetime.test.ts
  - openclaw_runtime/src/gateway/session-activity-handler.test.ts
  - openclaw_runtime/src/gateway/session-resource-inventory.ts
  - openclaw_runtime/src/infra/agent-events.ts
  - scripts/repository-artifacts.json
  - scripts/lib/resource-mixed-measurement.d.mts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/en/taskLedger.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ja/taskLedger.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/ru/taskLedger.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/zh/taskLedger.json
  - shared/session-task-scope.ts
  - shared/task-system/identity.ts
  - shared/task-system/store.ts
  - shared/types/session-derivation.ts
  - shared/types/session-handoff.ts
  - shared/types/session-stage.ts
  - shared/types/task-ledger.ts
  - shared/types/workspace.ts
  - src/App.tsx
  - src/components/chat/ResourceChip.tsx
  - src/components/chat/SessionDelegationStatus.tsx
  - src/components/chat/SessionFamilyNavigation.tsx
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/components/file-preview/WorkspaceSubagentPanel.tsx
  - src/components/layout/MainLayout.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/components/task-ledger/TaskLedgerSummaryPanel.tsx
  - src/components/task-ledger/TaskNodeSelector.tsx
  - src/lib/host-api.ts
  - src/lib/session-read-model.ts
  - src/lib/workspace-session.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/use-session-reading-position.ts
  - src/pages/Projects/index.tsx
  - src/pages/Settings/sections/ArchivedSection.tsx
  - src/pages/TaskLedger/index.tsx
  - src/stores/chat.ts
  - src/stores/session-activity.ts
  - src/stores/workspaces.ts
  - src/styles/codex-sidebar.css
  - tests/e2e/chat-session-fork.spec.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/fixtures/session-task-chain.ts
  - tests/e2e/project-agent-entry.spec.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/session-family-lifecycle.spec.ts
  - tests/e2e/session-task-scope-completion.spec.ts
  - tests/e2e/session-task-scope-derivation.spec.ts
  - tests/e2e/session-worker-task-journey.spec.ts
  - tests/e2e/session-task-locales.spec.ts
  - tests/e2e/long-session-coordination.spec.ts
  - tests/e2e/session-chain-scope-faults.spec.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
  - tests/unit/chat-send-input-mode.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/long-session-continuity-context.test.ts
  - tests/unit/long-session-coordinator-binding.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - tests/unit/provider-capability-store-roundtrip.test.ts
  - tests/unit/provider-runtime-sync-r4-file.test.ts
  - tests/unit/session-activity-background-read.test.ts
  - tests/unit/session-activity-store-scope.test.ts
  - tests/unit/session-delegation-status.test.tsx
  - tests/unit/session-chain-panels.test.tsx
  - tests/unit/cron-api-browser-automation.test.ts
  - tests/unit/session-family-navigation.test.tsx
  - tests/unit/session-family-read-model.test.ts
  - tests/unit/session-handoff-recovery.test.ts
  - tests/unit/session-lifecycle-control-scope.test.ts
  - tests/unit/session-task-scope-bridge.test.ts
  - tests/unit/user-message-queue.test.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/unit/sidebar-render-containment.test.tsx
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/unit/task-ledger-snapshot-cache.test.ts
  - tests/unit/long-session-runtime-resource-inventory.test.ts
  - tests/unit/session-task-scope.test.ts
  - tests/unit/durable-task-session-scope.test.ts
  - tests/unit/workspace-agents-panel-failure.test.tsx
  - tests/unit/workspace-session.test.ts
  - tests/unit/workspaces-store.test.ts
  - vite.config.ts
  - openclaw_runtime/src/agents/bash-tools.exec-types.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-gateway.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-reservation.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
touchedAreas: *a1
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - autonomy-session-task-scope-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - comms-regression
  - docs-sync
  - repository-artifact-retention
  - durable-task-system-boundary
  - task-forest-autoclose-and-roles
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Project and session navigation retain explicit task scope, drafts, sources
    and generation-bound state.
  - First effects use real tasks and one writer; fork and handoff never inherit
    a writer claim.
  - Lost responses and restart recovery reuse the same child and first-send
    identity.
  - Admission, run completion, report delivery, task acceptance and parent
    continuation retain separate owner facts.
acceptance:
  - "TF-0658: 任务/会话/运行/归档状态分别读取；等待显示依赖或容量原因，用户不需记忆task/session/worktree ID才能继续工作。"
  - "TF-0661: 迁移/恢复/归档恢复通过现有工作入口可达；常规已授权动作不重复确认；真实决策提示含推荐动作、影响和可回读状态。"
  - "TF-0662: 2026-11-08统一方案增补：现状与候选配对记录身份手选、跨页、重复确认、目标重述及重复提醒，agent驱动指标不写成人类认知试验。"
  - "TF-0657: ChatSession 和 sessions.list 映射保留 spawnedBy 及既有 fork 字段；来源分类复用
    SessionDerivation，Task Ledger sessionLinks 不作为第二树真源。"
  - "TF-0657: 2/20/100 后代 fixture、多代链、跨项目/工作线、未加载父项与真正
    parent-missing、cycle、bound-exceeded 均不丢行、不伪造根或直接父级。"
  - "TF-0657: 保持 workspace/workstream assignment；临时 run 没有持久 child key
    时不伪造可打开会话。"
  - "TF-0657: 现有 helper 复用或收敛后有实际消费者计划；不新增 lineage store/writer，不为每行轮询完整
    activitySnapshot。"
  - "TF-0657: 聚焦单测、uncached typecheck、contract:check 通过；通信数据路径变化执行 comms
    replay/compare，读回 source/fixture/command/exit/count 证据。"
  - "TF-0657: 真实Gateway
    row同时携带parentSessionKey与spawnedBy时仍分类为Spawn；两者矛盾保留诊断。现有stage
    projection消费者同步回归，无分类漂移。"
  - "TF-0657:
    已有任务关联、尚无任务的discussion、无法读取owner、stale/generation-mismatch分别可表达；不可把空任务或unkn\
    own默认为已完成。"
  - "TF-0657:
    按project/workspace/session键隔离加载和缓存，不新增逐行activity轮询，不从标题或ID字符串猜角色/归属。"
  - "TF-0658:
    项目/工作线内按需展开多后代，最多额外一层缩进；完整来源链与真实直接父级在同一关系详情可达。时间排序仍平铺，跨分组来源链接不搬动或复制会话。"
  - "TF-0658: 30px 行高、标题截断/tooltip、状态 orb 和 Pin/⋯ 保持现行配方；disclosure
    为左侧结构控制，支持键盘和 aria-expanded。"
  - "TF-0658: 来源 breadcrumb、后代列表和 worker transcript
    目的地可辨；选择后代展开必要祖先，不抢焦点，不覆盖两边各自草稿和可恢复阅读位置。"
  - "TF-0658: 父会话仅汇总真实子状态，自己的状态独立；后台新增/失败/完成不自动切换、不把 hover 行持续重排。"
  - "TF-0658: 本阶段增加 Electron E2E 并回读
    Light/Dark、1280x800/960x800、键盘、折叠侧栏截图和断言；四语完整，sidebar-render-containment
    无回归。"
  - "TF-0658: 点击项目名到正确负责人；切项目/会话保留草稿和阅读位置，错误workspace结果不能覆盖当前页。"
  - "TF-0658: 每个会话有任务容器；discussion为空有明确文案，执行会话显示当前任务/全部任务/验收和来源，任务状态只从owner读取。"
  - "TF-0658:
    已有/未绑定负责人、首屏空态、loading/failed/stale/permission不可用均可见；窄窗任务抽屉与键盘操作有Electron证据\
    。"
  - "TF-0659: 消息“在新会话中提问”有源标题、真实边界和可编辑问题预览；用户消息使用最近 assistant
    祖先，说明此提问之前上下文，无祖先/无 entryId/忙态拒绝而不退化 tip fork。"
  - "TF-0659: 确认后以现有 fromLeafId Fork，子会话 composer
    只预填问题且不发送；取消无副作用、失败不丢问题或源草稿、重复点击只创建一次。"
  - "TF-0659: 核对 ad77bf57c 的有意首轮发送行为；Handoff
    主按钮明确为“创建并发送”，旧规格/测试标题/四语一致；发送失败保留已创建 child、来源和可恢复草稿。"
  - "TF-0659: Handoff 创建失败不切换；首轮效果未知先查询 owner 结果，不能自动重发或创建第二
    child；来源告警、深度上限、gateway/active-run 拒绝均有可见反馈。"
  - "TF-0659: 会话内模型提出新会话建议只能进入同一预览确认；普通回复文字不能触发隐式创建，不新增第二派生关系或文本正则执行器。"
  - "TF-0659: Electron E2E 断言 Fork chatSend=0 与 Handoff
    显式一次首发；取消、创建失败、发送失败/未知、重复提交、旧会话晚到响应均覆盖。"
  - "TF-0659: 新Handoff在runtime SessionDerivation中有持久直接父级，重载来源不依赖Task
    Ledger推树；runtime失败不激活假child，部分成功可恢复，权限及generation屏障保持。"
  - "TF-0659: 创建响应丢失、首发超时、重复点击、A→B→A和进程重启均先回读持久操作与owner
    run/transcript/receipt；同一操作不再创建child，同一发送重试复用key。无可证明结果则保持unknown，不盲重发或声称ex\
    actly-once。"
  - "TF-0659: 新增owner单测及Electron中断/重启恢复断言；contract、comms
    replay/compare和窄spec验收通过后才宣称完成。"
  - "TF-0659: Fork
    child默认仅有关联/只读职责，写前经A4重新准入；handoff关联与generation换代可对账，旧执行权不可继续用。"
  - "TF-0659: 同逻辑操作重试复用持久key；同payload的新合法意图可单独创建，key不只由payload hash派生。"
  - "TF-0660: 复用现有 Team/Agents/Activity，不建第二控制台；角色/任务/隔离/来源按已有事实按需展示，未知字段不猜测。"
  - "TF-0660: admission 的 accepted-not-completed
    只显示已接收；running/waiting/partial/rejected/outcome-unknown/report/Task
    接纳/parent continuation 分别来自真实 owner receipts。"
  - "TF-0660: 有持久可访问 child key 才提供 transcript 导航；run-only/已 cleanup/尚无
    child/读取失败有独立状态且无伪造消息。"
  - "TF-0660: 传递显示源、目标和回执阶段；仅暴露当前 host 已支持 send/steer/stop/查询动作，不把只读界面变成跨
    workspace 自授权入口；模型专用 yield 保持 tool-owned。"
  - "TF-0660: 重复完成/回传、generation mismatch、晚到结果、Gateway
    不可用、审批等待/拒绝不串会话、不假成功；未知结果可核实恢复。"
  - "TF-0660: 本阶段 Electron E2E + 实际 Host/Gateway receipt 接线分别记录；界面 mock 不冒充
    runtime 完成；contract/comms/typecheck/i18n 门禁通过。"
  - "TF-0660: 同项目多个coordinator/worker不串任务，项目与会话视图来自同一owner；实际运行模型可见，未知费用不填0。"
  - "TF-0660: accepted/text/exit0/turn-check done均不能提升为业务任务已验收；从任务可定位worker
    transcript和相关产物。"
  - "TF-0660: 有scope无新grant的既有授权操作不反复要求用户确认；无授权或不可用能力明确阻止，不把状态投影变成许可。"
  - "TF-0661: 输出操作→owner/host
    action→可用条件→确认/取消→pending/success/failure/unknown→恢复的完整矩阵，覆盖
    new/switch/reopen/stop、协调暂停继续、archive/undo/restore/delete、compact/range/che\
    ckpoint restore/reset。"
  - "TF-0661: SessionKey、generation、run、leaf 不混同；compact/reset/restore
    是同逻辑会话事件，不新增树节点，默认关闭原语仍关闭。"
  - "TF-0661: Stop 与 Delete 分开；永久删除有确认，归档可撤销；沿用 owner admission/lifecycle
    屏障、既有衍生数据清理和权限，不新增孩子级联删除。"
  - "TF-0661: 父项归档/删除后的幸存孩子可达，区分未加载/不可访问与真的 parent-missing；不伪造 root，也不因 parent
    hidden 丢行。"
  - "TF-0661: busy/后端不支持/过期generation 有具体禁用理由；晚到结果不覆盖当前会话，失败/未知不清掉可恢复输入。"
  - "TF-0661: 每项已有动作有正向与拒绝/取消/恢复 Electron 断言；没有现有控制接口的能力如实说明，不新造通道假接线。"
  - "TF-0661: 停止/取消不会先显示成功再等待后端；暂停与恢复竞态依实际版本和有效策略裁决。"
  - "TF-0661: 归档不标任务done、不隐式级联孩子、不删除被任务引用的唯一产物；dirty/未推送资源保留或明确阻止回收。"
  - "TF-0661: 上下文token、进程RAM和accepted memory分别展示；compact/checkpoint恢复不是新谱系关系。"
  - "TF-0662:
    同候选跑父→多个孩子→多代→返回来源→Fork问题→Handoff→Spawn→结果回传→parent续接→archive/restore/delet\
    e/stop/context恢复整链，required case 0失败/0非预期skip。"
  - "TF-0662:
    Light/Dark×1280x800/960x800、collapsed、keyboard/focus、reduced-motion、长标题和2/2\
    0/100后代无重叠/丢行/横溢；保留瞬时创建/传递/失败状态截图。"
  - "TF-0662: 按现有性能预算记录加载/RPC/重渲染数据并比较基线；不新设拍脑袋通过线，不把fixture压力测试写成真实生产规模证据。"
  - "TF-0662: uncached
    typecheck、contract:check、i18n:lint、build:vite、聚焦单测/Electron回归、comms
    replay/compare、harness validate/run 门禁均有实际命令/退出码/计数。"
  - "TF-0662: 精选证据含 actor/driven_by=agent、source/candidate
    identity、manifest/SHA256、负例、未测范围，Host mock 与实际 Gateway 接线证据分开，独立agent回读复核。"
  - "TF-0662:
    README四语、UI契约/旧handoff冲突均同步；所有前置叶子有证据后再proposal-apply/validate/export收口，不改变\
    发布或冻结默认。"
  - "TF-0662: 整链覆盖Spawn双父字段、Handoff
    runtime来源重载、创建响应丢失与首发未知的进程重启恢复；记录同一child/send key和实际对账来源，无法确认的结果如实unknown。"
  - "TF-0662: 同一候选覆盖项目名→负责人→任务清单→父/子会话→来源→产物往返，跨scope切换与空/错/stale状态均测试。"
  - "TF-0662: 增加任务绑定/写claim不继承/自动验收与turn记录区分/归档保留证据负例；mock与真实Gateway证据分开。"
  - "TF-0662: 所有新增UI在各自叶子已交付E2E，本节点聚合重跑；保留原视觉、2/20/100后代及性能预算，不降低旧验收。"
  - "TF-0673: 新会话、讨论转执行、已有任务进入、派发、handoff、fork均有可追溯任务绑定。"
  - "TF-0673: Fork不会继承有效写claim/lease；Handoff换代后旧执行者不能继续写；工作组移动不改任务归属。"
  - "TF-0673: 任务引用缺失/跨项目/已失效时副作用被拒；UI可读取空/不可用/陈旧状态。"
  - "TF-0673: 负例：无任务副作用；同任务双执行者；externalRef冒充Ledger完成；标题推断任务身份"
  - "TF-0673:
    证据包含driven_by:agent、真实actor、source/candidate/输入配置版本、命令/exit/count、artifact
    hash、负例与未测范围；不以stdout或模型自述收口。"
  - "TF-0673: 连续10轮普通讨论不创建业务task；明确执行意图只建立一个幂等主任务及必要checks；绑定已有任务不改完成状态。"
requiredTests:
  - pnpm exec playwright test tests/e2e/session-task-locales.spec.ts --workers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.process-control.config.ts src/agents/verseshell/managed-process-capacity.test.ts src/agents/verseshell/governed-process.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts src/agents/orchestrator-write-set-plan.test.ts src/agents/orchestration-write-set.test.ts
  - pnpm exec vitest run tests/unit/sidebar-render-containment.test.tsx tests/unit/durable-task-session-scope.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm --dir openclaw_runtime test src/agents/tool-mutation.test.ts
    src/agents/embedded-agent-runner/runs.task-scope.test.ts
    src/cron/isolated-agent/run-runid-canonical.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run build:runtime
  - pnpm exec vitest run tests/unit/session-task-scope-completion.test.ts
    tests/unit/session-task-scope-bridge.test.ts
    tests/unit/session-family-read-model.test.ts
    tests/unit/session-family-navigation.test.tsx
    tests/unit/session-handoff-recovery.test.ts
    tests/unit/session-delegation-status.test.tsx
    tests/unit/session-lifecycle-control-scope.test.ts
    tests/unit/workspaces-store.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/session-task-scope-completion.spec.ts
    tests/e2e/session-worker-task-journey.spec.ts
    tests/e2e/project-agent-entry.spec.ts
    tests/e2e/session-derivation-ui.spec.ts
    tests/e2e/session-chain-scope-faults.spec.ts --workers=1
  - pnpm exec playwright test tests/e2e/chat-session-fork.spec.ts
    tests/e2e/chat-session-handoff.spec.ts
    tests/e2e/sidebar-session-folders-archive.spec.ts
    tests/e2e/chat-checkpoints.spec.ts
    tests/e2e/chat-session-compact-range.spec.ts
    tests/e2e/chat-slash-session-lifecycle.spec.ts
    tests/e2e/long-session-coordination.spec.ts
    tests/e2e/long-session-delegation-admission.spec.ts
    tests/e2e/long-session-completion-continuation.spec.ts --workers=1
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm repo:artifacts:check
  - pnpm harness validate --spec
    harness/specs/tasks/session-task-chain-acceptance.md
  - pnpm harness run --spec harness/specs/tasks/session-task-chain-acceptance.md
    --dry-run
  - pnpm exec playwright test tests/e2e/session-family-lifecycle.spec.ts
    tests/e2e/chat-manual-compaction.spec.ts
    tests/e2e/long-session-lifecycle-faults.spec.ts
    tests/e2e/runtime-lifecycle-governance.spec.ts --grep "delete success|delete
    failure|archiv|generation-scoped|confirmation" --workers=1
  - pnpm exec vitest run tests/unit/provider-runtime-sync-r4-file.test.ts
    tests/unit/workspaces-store.test.ts
    tests/unit/session-family-navigation.test.tsx
    tests/unit/session-task-scope-bridge.test.ts
    tests/unit/chat-send-input-mode.test.ts --maxWorkers=1 --no-file-parallelism
docs:
  required: true
  readmeTranslations: required
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/modules/multi-agent-and-tasks.md
    - docs/dev/session-lifecycle-control-matrix.md
    - docs/modules/llm-and-models.md
---

This aggregate verification retains all original criteria for TF-0673 and TF-0657–TF-0662.
Implementation ownership remains in the six narrow session task specifications.
The selected scope excludes autonomous project planning and cross-project scheduling.

Reports distinguish local scripted model decisions, real Main/Gateway/tool effects,
UI replay fixtures, and unit-level fault injection. The final report records exact
commands, exits, counts, source identity, hashes, initial failures and independent review.
