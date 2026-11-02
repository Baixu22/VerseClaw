---
lifecycleStatus: active
id: context-folding-rlm
title: 实现可审计的上下文折叠、按需展开与真实任务 eval
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 在现有 Context Orchestrator、CompressionArtifact、context tools 和 subagent 基础上增加默认关闭的 ContextHandle、bounded expansion 与 FoldedResult 路径，并用真实代码任务、功能测试和 paired eval 证明其质量、证据和成本边界。
touchedAreas:
  - harness/specs/tasks/context-folding-rlm.md
  - harness/specs/scenarios/context-folding-rlm.md
  - harness/specs/rules/context-folding-boundary.md
  - harness/specs/guides/context-folding-rlm-design.md
  - harness/specs/fixtures/context-folding-rlm/**
  - shared/types/context-folding.ts
  - shared/types/context-item.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/handoff-artifacts.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - tests/unit/context-folding-*.test.ts
  - tests/integration/context-folding-*.test.ts
  - tests/e2e/context-folding-real-task.spec.ts
expectedUserBehavior:
  - 代理能识别大材料并使用可验证 handle，而不是把完整原文或完整子任务轨迹塞入父上下文。
  - 代理能按需读取 bounded excerpt，并在 stale、missing、cross-scope 时得到明确诊断。
  - 代理能把独立工具密集型子任务折叠为包含摘要、结构化结果、evidence refs、未解决项和成本的结构化结果。
  - 用户最终看到的是可复查的结果和证据，而不是仅凭模型文本声明的完成。
  - 功能关闭时现有 Context Orchestrator、compaction、context_read/search 和 subagent 路径保持兼容。
requiredRules:
  - identity-scope-boundary
  - contract-first-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - context-family-boundary
  - context-folding-boundary
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredProfiles:
  - fast
  - comms
  - e2e
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-folding-rlm.md
  - pnpm harness validate --spec harness/specs/tasks/context-folding-rlm.md --no-diff
  - pnpm exec vitest run tests/unit/context-folding-contract.test.ts tests/unit/context-folding-result.test.ts
  - pnpm exec vitest run tests/integration/context-folding-real-task.test.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/context-folding-real-task.spec.ts
plannedTests:
  - tests/unit/context-folding-contract.test.ts
  - tests/unit/context-folding-result.test.ts
  - tests/integration/context-folding-real-task.test.ts
  - tests/e2e/context-folding-real-task.spec.ts
acceptance:
  - Phase 0 freezes the handle/expand/fold contracts, off-mode parity, tests, real-task fixture and eval gates; no runtime behavior changes before a separate implementation leaf.
  - A controlled ContextHandle resolves only within the requester's session/workspace scope, verifies checksum/freshness where available, and returns visible stale/missing/ambiguous diagnostics.
  - Bounded expansion returns only an excerpt/search/aggregate within its declared char and byte limits; no arbitrary Python/pip/shell path is introduced.
  - A child task returns ContextFoldResult with summary, structured output, evidence refs, unresolved claims, blockers, failed attempts, child identity and usage; the parent does not receive the child transcript by default.
  - Existing context_read/context_search/context_archive_recall, CompressionArtifact, SessionStartInjection, compaction and subagent behavior remain compatible when the new feature is off.
  - Functional tests cover success, timeout, cancel, partial result, stale/missing selector, checksum mismatch, cross-session/workspace access and duplicate/replayed delivery.
  - The real workspace fixture is copied to D:/tmp before execution, the real task oracle exits 0 with zero skipped tests, and the resulting patch/tests/evidence are readable from disk.
  - The paired eval compares baseline, expand-only and folded-child on the same frozen task; quality/evidence gates pass and main-context reduction is reported separately from total token/latency/cost.
  - Feature default remains off, no existing product lock or default value changes, and disable-only rollback is documented and exercised.
  - All evidence is agent-driven with driven_by=agent and actor recorded; no real-human or release-approval claim is made.
docs:
  required: true
  files:
    - harness/specs/guides/context-folding-rlm-design.md
    - harness/specs/rules/context-folding-boundary.md
    - harness/specs/scenarios/context-folding-rlm.md
    - harness/specs/fixtures/context-folding-rlm/README.md
---

# Context Folding RLM Task

这是 `context-folding-rlm` 支线的 durable task entry point。它把上一轮 RLM 对比转化为可执行的开发、功能验收和 eval 合同。

本文只冻结契约、测试入口、真实任务 fixture 和验收边界；不宣称任何实现已经落地。实现必须在专用 worktree 中按 Task Forest 的 ready leaf 串行推进。

## Task Forest 节点映射

本地 Task Forest 已建立并校验通过：

| 节点 | 职责 |
| --- | --- |
| TF-0690 | 专用 worktree 里程碑（child_of TF-0686，contributes_to TF-0664） |
| TF-0691 | 冻结 ContextHandle、bounded expand 与 FoldedResult 合同（唯一 ready） |
| TF-0692 | 接入有界 ContextHandle 展开读面 |
| TF-0693 | 实现单层子任务 ContextFoldResult 回传 |
| TF-0694 | 完成功能、故障与安全验收 |
| TF-0695 | 执行真实任务与 baseline/expand/fold paired eval |

除 TF-0691 外，其余实施叶子保持 proposed，按 depends_on 链推进。

未产生本轮实现 diff 时，worktree 入口用 `--no-diff` 做结构校验；一旦产生实现 diff，必须运行不带窄化参数的完整 ownership diff 门，`--no-diff` 不能代替最终验收。

## 工作树

- worktree tag：`worktree:context-folding-rlm`
- expected root：`<worktree-root>/context-folding-rlm/ClawX`
- 该支线只允许一个 ready leaf；其他叶子按依赖保持 proposed。
- 只提交本 worktree 的规范、实现和最终证据；不覆盖其他 worktree 或并行改动。

## 分阶段交付

### CF-01 契约与关闭等价

- 定义 `ContextHandle/v1`、`ContextExpandRequest/Result/v1`、`ContextFoldRequest/Result/v1`。
- 定义 feature flag、错误码、scope/checksum/freshness 和 usage 字段。
- 增加纯合同测试和 off-mode byte parity 测试。
- 不改运行时代码路径。

### CF-02 bounded expansion

- 复用现有 `context_read`、`context_search`、`context_archive_recall` 和 selector resolver。
- 增加只读 `context_expand`，或在现有工具上增加等价 bounded 模式。
- 不新增任意代码执行、pip、shell 或跨 scope 读面。

### CF-03 child fold

- 复用 `sessions_spawn`、subagent result、steering queue 和 orchestration result bundle。
- 子任务返回 `ContextFoldResult`；父会话只接收 bounded projection。
- 失败、超时、取消、部分完成、未知交付均保留独立状态。

### CF-04 功能与故障验收

- 跑 unit/integration/e2e、typecheck、contract、comms replay/compare、真实任务。
- 增加负例：跨 session、stale、checksum mismatch、无 evidence、raw transcript 回灌、重复 delivery。
- 验证 off-mode parity 和 disable-only rollback。

### CF-05 真实任务与 eval

- 使用 `harness/specs/fixtures/context-folding-rlm/real-task.v1.json`。
- 将 real workspace 复制到 `D:/tmp`，执行真实代码修改和 oracle。
- 比较 baseline、expand-only、folded-child。
- 保存 raw run、摘要报告、SHA256SUMS、credential scan 结果和只读回执。

## 真实任务

真实任务不是问答或 mock 摘要，而是一个带真实代码、真实测试和真实工具读取的仓库修改任务：

- workspace：`harness/specs/fixtures/context-folding-rlm/real-workspace`
- 初始状态：一处任务板重复完成导致 revision/event 重复的缺陷；测试必须由代理修复。
- 运行副本：`D:/tmp/context-folding-real-task-<runId>`
- oracle：`oracle/verify.py`
- 必须输出：patch、测试命令/exit code/计数、ContextHandle/expand/FoldedResult 事件、evidence refs、usage 和未解决项。

真实任务的详细 prompt、硬门和指标见 `real-task.v1.json`。

## Eval 门槛

只有以下条件同时成立才允许进入下一个 worktree 阶段或宣告该支线完成：

1. real-task oracle exit 0，0 failed / 0 skipped；
2. required evidence refs resolution = 100%；
3. scope violation = 0，raw child transcript 注入 = 0；
4. off-mode parity 通过，disable-only rollback 通过；
5. 质量不低于 baseline；
6. 主上下文减少与总 token/延迟/成本同时报告，不能用上下文节省替代质量；
7. 所有证据标为 agent-driven，无 real-human/发布批准声明。

## 回退

关闭 `context.folding.enabled`（或最终实现的等价 flag）后，旧 Context Orchestrator、compaction、context tools、subagent 和 prompt 路径必须恢复。禁止为回退删除证据、重写历史或修改其他 owner 的状态。

## 非目标

- 不把任意 Python REPL 或 pip 安装带入默认桌面路径。
- 不默认开启递归深度大于 1 的子代理。
- 不把摘要、FoldedResult 或 context handle 当作完成权威。
- 不把真实任务变成真人操作或真人判定。
- 不在本支线同时实现不相关的 UI、Memory、Knowledge 或调度功能。
