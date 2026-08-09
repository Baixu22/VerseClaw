# 全量测试提示词 — Verse Claw DCS 架构健康度 + RC 包完成度审计

> 交付对象：独立测试/审计 agent（全新上下文）
> 生成日期：2026-08-09
> 仓库：`C:\Users\27933\Desktop\clawx\ClawX`（Windows，PowerShell 5.1；Git Bash 亦可）
> 本提示词自包含：所有路径、命令、基线数字与已知偏差均已写明，无需依赖会话记忆。

## 0. 你的任务

对以 **DCS（Durable Context System，context-runtime-kit 上下文引擎）** 为核心的系统架构做一次**全量测试与健康度审计**，并给出**此前 Runtime Authority Convergence RC 包（RC-00..RC-10）的完成度评估**。输出一份结构化报告（见 §7 交付物）。只做测试/审计/评估，不改生产代码（如发现缺陷，记录为 finding 即可；如需修复须单独说明）。

## 1. 当前状态快照（事实基线）

- 主工作树 HEAD：`55ec051ec5b38e2415ea6905437fe6a6d3b8305a`（main，已同步 origin/main）。
- Runtime Authority Convergence 程序：**done**（2026-08-09，用户 accepted 判定 + human-phase validator PASS）。
- 工程验收候选链：分支 `rc09-final-candidate`，HEAD `3209f098105080effd4789baee3ef644793c50da`，基于 accepted base `b8a6c1832ef7aca6c7d6286f80f5aee74c6e5d2c`；候选 worktree 在 `C:\Users\27933\Desktop\clawx\ClawX-rc01r-candidate`（仅验收证据用，测试在主工作树跑）。
- 最终验收证据：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/{manifest,executor-report,verifier-report,final-report,changed-path-ownership}.json`（Verifier `engineeringAcceptedByAgent=true`，18 gates 全过，7116 passed/0 failed/52 skipped）。
- 各包独立验收产物：`artifacts/agent-engineering-acceptance/runs/rc{01r,04r..08b}-accept-*/`（rc00 参照 `runs/rc00-f4-restore-5/`）。
- RC-10 真实轮证据：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/rc10-round-1/`；`human-verdict.yaml` = accepted。
- 控制文档：`docs/dev/unified-agent-system/runtime-convergence/{STATUS.md,WORK-PACKAGES.md,ACCEPTANCE.md,HUMAN-ACCEPTANCE.md,AGENT-START.md,TARGET-ARCHITECTURE.md}`；交接记录 `docs/dev/handoffs/LATEST.md`。

## 2. DCS 架构地图（被测对象）

### 2.1 核心（openclaw_runtime/src/context-engine/）
- 组装与封存：`assembler.ts`、`context-orchestrator.ts`、`compile-plan.ts`、`context-bundle.ts`、`seal-registry.ts`、`rc03-seal-hook.ts`、`rc03-producers.ts`（knowledge / working_memory / tool_registry / cvk_addition 四个 producer channel）、`context-candidate.ts`、`delegate.ts`、`legacy.ts`、`legacy.registration.ts`、`registry.ts`、`provider-registry.ts`、`init.ts`
- 预算与记账：`turn-injection-budget.ts`、`injection-budget.ts`、`dcs-receipts.ts`（ReceiptBudget）、`dcs-observability.ts`、`workspace-fingerprint.ts`
- 决策与旗标：`dcs-canary-c1.ts`、`dcs-graduation-decision.ts`、`dcs-prod-flags-catalog.ts`、`runtime-flag-ack.ts`、`runtime-flag-attribution.ts`、`shadow-flags.ts`、`kill-switch-config-source.ts`、`enhancement-kill-switch.ts`、`dcs-context-tools-flags.ts`、`coding-runtime-flags.ts`
- 块与存储：`block.ts`、`block-store.ts`、`block-lifecycle.ts`、`memory-context-provider.ts`、`role-memory-context-provider.ts`、`symbol-context-provider.ts`、`trace-context-provider.ts`、`agent-map-context-provider.ts`、`context-pack-provider.ts`、`impact-provider.ts`、`register-memory-providers.ts`、`register-rebuild-providers.ts`、`runtime-embedding-adapter.ts`
- 注入路径：`chat-turn-memory-injection.ts`、`chat-turn-vtoken-injection.ts`、`vtoken-rpc-client.ts`、`task-state-rewrite.ts`、`context-ladder.ts`、`token-pressure.ts`
- 实验/语料：`coding-*.ts`（AB fixtures、C6H flip、long-chat-curve、tool-navigation）、`dcs-corpus-*.ts`

### 2.2 生产接线（runner 侧）
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`（~3295 行起为 `cvk_addition` 候选采集点；`collectContextOrchestratorCandidate` / `recordContextOrchestratorSourceDecision`）
- `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`（producer 接线，channel=cvk_addition 过滤）
- `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts`（+test）
- `openclaw_runtime/src/agents/dcs-producer-envelope.ts`（+test：edit/write/apply_patch 带 `details.working_memory` envelope）
- 各上下文块 extension：`extensions.working-memory.*`、`extensions.task-state.*`、`extensions.tool-registry.*`、`extensions.knowledge.*`、`sekb-runtime.*`（+各自 test）

### 2.3 UI/桌面侧（renderer）
- `src/pages/Settings/...` DCS 生产旗标面板（`dcs-prod-p0-settings` E2E 覆盖）、`dcs-preview-optin-fp-p1-03`、`dcs-flag-ack-tuning-fp-p1-09`、`dcs-production-wiring-w5` E2E spec 对应页面/组件。

## 3. RC 包完成度矩阵（审计依据）

| 包 | Spec | 验收 run | 核心证明 | 状态 |
|---|---|---|---|---|
| RC-00R | rc00-agent-engineering-acceptance-bootstrap.md | runs/rc00-f4-restore-5 | acceptance 控制面（plan/executor/verifier、digest、phase、ownership） | 独立验收 PASS |
| RC-01R | rc01r-self-contained-baseline.md（+rc01-authority-inventory-baseline） | runs/rc01r-accept-1 | baseline.json（acceptedBaseSha=b8a6c1832）、39 writers 分类、runtime-family/spine frozen | 独立验收 PASS |
| RC-02R | rc02-full-payload-shadow-census.md | （并入 rc04r 链） | ReceiptStore typed canonical、shadow Context/Wire receipts、npm degraded | 最终候选覆盖 PASS |
| RC-03R | rc03-dcs-seal-dual-receipts.md | （并入链） | DCS seal hook、ContextReceipt/v1+WireReceipt/v1、rc03-producers 四 channel | 最终候选覆盖 PASS |
| RC-04R | rc04-durable-approval-effect-reconciliation.md | runs/rc04r-accept-8 | ApprovalLedger 唯一 owner、digest-only、CAS 状态机、EffectReceipt 8 维幂等、recoverPendingFromLedger | 独立验收 PASS |
| RC-05R | rc05-minimal-operator-governance-slice.md | runs/rc05r-accept-1 | operator-slice 三阶段、inbox.operator.*、channel-conformance 可执行 fixture | 独立验收 PASS |
| RC-06AR | rc06a-taskflow-capability-proof.md | runs/rc06a-accept-1 | TaskFlow CAS（sentinel/UPDATE WHERE revision/并发唯一 winner/restart） | 独立验收 PASS |
| RC-06BR/CR/DR | rc06b/c/d-*.md | runs/rc06b-accept-2、rc06c-accept-1、rc06d-accept-2 | ClawGraph/Mission/TaskLoop → TaskFlow 投影（cancel/restart/child/wait/cancelled） | 独立验收 PASS |
| RC-07R | rc07-memory-context-slot-convergence.md | runs/rc07-accept-1 | DCS 唯一 contextEngine owner、slot-convergence fail-closed、parallel writers=0 | 独立验收 PASS |
| RC-08AR | rc08a-mcp-host-native-tool-convergence.md | runs/rc08a-accept-1 | MCP 真实 initialize handshake、fake-connected=0 | 独立验收 PASS |
| RC-08BR | rc08b-otel-observability-convergence.md | runs/rc08b-accept-1 | OTLP 导出、golden trace、redaction、exporter-off parity | 独立验收 PASS |
| RC-09 | runtime-authority-convergence-final-acceptance.md | runtime-authority-convergence-final/ | 18-gate 双角色 PASS、ownership matrix 99 paths | 独立验收 PASS |
| RC-10 | rc10-human-acceptance-runbook.md | rc10-round-1/ | H-01..H-06 真实轮 + human-verdict accepted（H-03 以 fixture 按用户 override） | 用户 accepted，程序 done |

> 注意：RC-02R/03R 无独立 run 目录（其证据并入候选链，由 RC-09 最终验收与 rc03/rc02 运行时测试覆盖）；审计时以最终候选范围（99 paths，见 changed-path-ownership.json）为准。

## 4. 已知偏差与基线（务必对照，勿当作新发现重复）

1. **FP-P1-11 DCS budget channel 偏差**：真实轮中 `byChannel` 计费了 `cvk_addition` 而未计费 `working_memory`（确定性复现，见 `rc10-round-1/run-record.md`）；运行时单测（`dcs-producer-envelope.test.ts`、`turn-injection-budget.test.ts`、`extensions.working-memory.test.ts`）对该机制覆盖全过。请审计：working_memory producer 在真实 attempt 路径中为何未产出可计费块（可能为空块未注入）。
2. **FP-P1-01 Setup provider/model 验证 E2E**：`setup-complete-provider-verified` 在 scripted 端点下未达成（环境方差，H-01 同端点通过）。
3. **全量 E2E 基线**：本会话前全量 286 测试曾 80 失败；本会话已修复：chat-session-fork 3/3、chat-session-handoff 2/2、rc05-operator-inbox 2/2、restart-recovery-fp-p1-05 1/1、coding-loop-fp-p1-04（仅剩 FP-P1-11 断言）、chat-input/chat-runtime-event-handlers/uas-05 单测、lint 5 errors、kysely/hoisting（bundledMainRuntimeDependencies 已含 kysely/tslog）。**其余失败请以本次实测为准重新清点**（visual 快照类属正常需刷新；recovery/rollback 面板迁移类属 UI workstream）。
4. **主工作树历史 rc01 基线测试**：main 与 origin/main 同步时 `rc01-authority-inventory-baseline.test.ts` 的 "pins acceptedBaseSha" 用例按设计失败（该测试面向候选 worktree）；在候选 worktree 全绿。审计时如遇到请勿误报为回归。

## 5. 全量测试命令（按序执行，逐条记录 exit code 与计数）

### 5.1 单元/运行时
```powershell
pnpm run typecheck            # node+web 全量（~2-5min）
pnpm run lint:check           # 0 errors（warnings 基线 ~126 条，不得新增）
pnpm test                     # 根全量（预期 6533+ passed / 0 failed / 52 skipped；rc01 pins 用例在 main 侧按设计失败）
pnpm test:dcs                 # DCS 聚焦：context-engine + config + agents dcs 扩展（assembler/block/seal/budget/flags/sekb…）
pnpm --dir openclaw_runtime test:unit            # runtime 全量（fast+unit，预期 154+560 passed / 0 skipped）
pnpm --dir openclaw_runtime check --include-test-types   # runtime static（oxlint/tsgo/import cycles）
pnpm run build:runtime        # runtime bundle + smoke
pnpm run build:vite           # renderer + electron main/preload
pnpm run contract:check
pnpm run i18n:lint
pnpm run test:integration
pnpm run channel:conformance  # rc05-operator-fixture 可执行 conformance（预期 9/9）
pnpm run comms:replay && pnpm run comms:compare
```

### 5.2 DCS 专项（单测精读）
```powershell
pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts src/context-engine/assembler.test.ts src/context-engine/assembler.kill-switch.test.ts src/context-engine/context-orchestrator.test.ts src/context-engine/turn-injection-budget.test.ts src/context-engine/injection-budget.test.ts src/context-engine/dcs-receipts.ts src/context-engine/dcs-canary-c1.test.ts src/context-engine/dcs-graduation-decision.test.ts src/context-engine/dcs-prod-flags-catalog.test.ts src/context-engine/runtime-flag-ack.test.ts src/context-engine/runtime-flag-attribution.test.ts src/context-engine/dcs-observability.test.ts src/context-engine/workspace-fingerprint.test.ts src/agents/dcs-producer-envelope.test.ts src/agents/embedded-agent-runner/dcs-extension-deps.test.ts src/agents/task-loop-controller.dcs-phase-producer.test.ts src/agents/embedded-agent-runner/extensions.working-memory.test.ts src/agents/embedded-agent-runner/extensions.task-state.test.ts src/agents/embedded-agent-runner/extensions.tool-registry.test.ts src/agents/embedded-agent-runner/extensions.knowledge.test.ts src/agents/embedded-agent-runner/sekb-runtime.test.ts
```
> 审计要点：断言是否恒真/仅本地常量、skip 是否有据、`collectContextOrchestratorCandidate` 四 channel 是否都有真实 producer 执行证明、receipt/budget 是否与最终 send body 一致。

### 5.3 E2E（真实 Electron；先 build:vite + build:runtime 保持新鲜，FP-P3-05 guard 会校验）
```powershell
# DCS 相关
pnpm exec playwright test tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/dcs-preview-optin-fp-p1-03.spec.ts tests/e2e/dcs-flag-ack-tuning-fp-p1-09.spec.ts tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/coding-loop-fp-p1-04.spec.ts
# 治理/恢复/连续性（RC-04/05/06/10 相关）
pnpm exec playwright test tests/e2e/rc05-operator-inbox.spec.ts tests/e2e/restart-recovery-fp-p1-05.spec.ts tests/e2e/chat-session-fork.spec.ts tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-long-task-control.spec.ts tests/e2e/chat-recovery-assist.spec.ts tests/e2e/chat-manual-compaction.spec.ts
# 全量（可选，~1h）
pnpm exec playwright test
```

### 5.4 Harness（RC 包 spec 逐个校验，禁止 --no-diff）
```powershell
foreach spec in (rc00..rc10 全部 rc*.md) { pnpm harness validate --spec harness/specs/tasks/<spec> }
pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md --since b8a6c1832ef7aca6c7d6286f80f5aee74c6e5d2c
```

### 5.5 验收证据复核（只读）
```powershell
node scripts/validate-runtime-authority-convergence.mjs --phase engineering --manifest artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json --engineering-report artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json
node scripts/generate-rc09-ownership-matrix.mjs --base b8a6c1832ef7aca6c7d6286f80f5aee74c6e5d2c --head 3209f098105080effd4789baee3ef644793c50da   # 应输出 99 paths 全 owner
pnpm acceptance:agent:status --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final
```

## 6. 健康度判定标准（fail-closed 精神）

- **DCS 单一 owner**：parallel memory/context writer = 0；DCS 是唯一 contextEngine slot（RC-07）；kill switch 关闭后 legacy 路径字节一致（RC-03 parity）。
- **收据真实**：所有 source-runtime model call 同时有 Context/Wire receipts；receipt digest 与最终 send body 可重算一致；npm fallback 只报 degraded、receiptCoverage=0。
- **预算诚实**：turn-injection-budget 的 applied+dropped+truncated == requested；byChannel 与 precedence 无漂移（对照 FP-P1-11 已知偏差复核）。
- **无恒真断言**：每个收敛测试必须执行真实动作（restart/cancel/drop/rate-limit 真的发生）。
- **skip 预算**：根 52、runtime 0；任何 skip 偏差视为异常。
- **证据链**：每个 RC finding 在最终 report 中链接到 test file / command / log digest（见 remediation plan §19 finding 矩阵）。

## 7. 交付物（写入 `artifacts/system-health-audit/` 或报告给调用方）

1. `health-report.md`：DCS 各子系统健康判定（PASS/CONCERN/FAIL + 证据命令+计数），含 FP-P1-11 偏差的根因分析（尽力而为）。
2. `rc-completeness.md`：RC-00..RC-10 完成度矩阵（验收证据链 + 测试覆盖对照 + 缺口）。
3. `e2e-inventory.md`：全量 E2E 实测清点（pass/fail/skip 按 spec 分组，区分 pre-existing 与回归）。
4. `findings.md`：新发现缺陷（路径+行号+复现命令+严重度），不改代码。
5. 顶部 10 行结论摘要（健康总分：绿/黄/红 + 关键风险 3 条）。
