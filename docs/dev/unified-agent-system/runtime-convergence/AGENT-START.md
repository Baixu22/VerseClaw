> **2026-08-03 独立审计覆盖声明**：候选 `fac6327a2` 的结论是 `NO-GO`。
> 下文所有审计前的“已完成/已通过”只能视为历史声明，不能授权继续 RC-10 或后续实现。
> 当前先读 `RC-09-REMEDIATION-PLAN.md`，通过受支持的 Task Forest proposal 串行重开并复验
> RC-00..RC-09；没有新的独立 Verifier evidence，不得恢复 accepted 状态。

你将接管 ClawX Runtime Authority Convergence。若本文件与当前工作区证据冲突，以当前证据为准，记录冲突并停止相关实现；不要自行重开已冻结决策。

## 【工作目录】

`C:\Users\27933\Desktop\clawx\ClawX`

## 【用户目标】

将 ClawX 从平行建设通用 Agent Runtime 收敛为本地优先、跨入口、可审计的 OpenClaw Operator Desktop；完成开发、自动测试、独立 Agent 工程验收后，把所有真人操作集中到最后由用户验收。

## 【必须遵守的要求】

- 先按 `runtime-convergence/README.md` 的顺序读完整控制包。
- 一次只推进一个 Task Forest ready 节点和一个 RC 工作包。
- 每个实现包先建立 Harness task spec；通信改动引用 `gateway-backend-communication`。
- 不新增 runtime、workflow store、memory store、context store、协议、telemetry store、LLM router 或 planner 服务。
- 不改 `liveReady=false`、`productApproved=false`、`defaultOn=false`；不把 agent/synthetic 证据写成 human/live。
- 未到 RC-10 不调用真实 provider/channel 做真人验收。

## 【已确认事实与决策】

- [verified] OpenClaw 已有持久 TaskFlow、排他的 `memory`/`contextEngine` 插件槽、MCP SDK 和 OTel exporter；TaskFlow 的 SQLite CAS/正式 transition graph 尚未证明，RC-06A 前不能称为全域唯一 owner。
- [verified] UAS-02 只闭合增强候选，不等于全 provider payload 已闭合；TF-0013 的 done 结论需要复核。
- [verified] `runtime-spine` 是 `diagnostic_only`，不得晋升为权威。
- [verified] RuntimeTaskEventLog 已有 SQLite persistence adapter/schema，但 persist 默认关闭、记录会裁剪、事件 union 无 receipt/effect kind；保持诊断用途，不得晋升为 receipt owner。
- [verified] Receipt owner 决策已由用户确认（2026-08-02）：typed、append-only `runtime_receipts` 表落在既有 openclaw-state SQLite，经窄接口 `ReceiptStore` 访问；复用 shared state DB 的 schema/权限/WAL/busy timeout/重启持久化/immediate transaction；不新增 DB/sidecar/service/second runtime authority。`long_task_checkpoints` 被否决（可变 checkpoint/resume 真源、同幂等键更新 checkpoint_json、不能覆盖普通 model call）。七条硬约束：digest-only 载荷、同 idempotency_key 内容相同幂等成功/不同冲突失败、不用 max(sequence)+1 而用显式 attempt/model-call/wire-attempt identity、不静默裁剪、shadow 写失败不改发送行为但使 RC-02 验收失败、receipt 只解释不授权 replay、npm fallback 继续 degraded 不计入 coverage。
- [verified] 当前 approval pending/resolved 由 Gateway 进程内 `Map` 持有，重启会丢失；RC-04 必须先闭合 durable approval/effect reconciliation，RC-05 才能做重启垂直切片。RC-04R 本地实现（未独立验收）：`ApprovalLedger` 已为唯一 exec-approval owner 且生产默认启用，`recoverPendingFromLedger()` 恢复重启前 pending truth；raw request/proposal 只存 SHA-256 digest。RC-05R：Cron ingress 只创建 intent，批准来自显式治理 policy/Inbox 决策（actor+policyDigest）；channel-conformance 为可执行 fixture。RC-06A/06B/06C/06D：TaskFlow CAS 证明层 + 三域 read-only projection（cancelled 显式支持）。RC-07R：slotConvergenceErrors 由 activation planner fail-closed 消费，census 由真实源生成。RC-08AR（2026-08-08 独立验收 PASS）：`tool-convergence.ts` 生产 `classifyMcpCatalogServer` 接线到 `agent-bundle-mcp-runtime.ts` 目录条目（`transportType`+`health`），connected 仅由 SDK initialize 握手置位；真实 stdio MCP fixture 经 `createSessionMcpRuntime` 完成握手；websocket-only transport 由生产 resolver 拒绝。RC-08BR（2026-08-08 独立验收 PASS）：OTel/OTLP JSON exporter 接线到 observability cache（canonical ExportTraceServiceRequest；completed traces 导出、exporter-off parity、失败不改变 store）；correlation IDs 派生 OTLP trace/span id；redaction 攻击与 cache 可重建测试通过。RC-09A（2026-08-08 修复完成，候选 22a7bad35，未独立验收）：changed-path ownership matrix generator + validator fail-closed 校验 + final spec touchedAreas 覆盖累计 diff；RC-09 最终 21-gate 验收因 electron-e2e（kysely 未 hoist / 66 pre-existing UI 失败）与 release-baseline-validate（P6-005 证据再生成 chicken-and-egg）BLOCKED。
- [verified] 新收敛能力只走 source `openclaw_runtime@2026.6.2`；npm `2026.5.20` fallback 必须显式降级且不得虚报完整 receipt。
- [verified] DCS 最终方案是 attempt CompilePlan、per-model-call ContextBundle、ContextReceipt/WireReceipt；Phase 1 必须零行为变化。
- [verified] WireReceipt 必须在 provider-specific finalizer 之后的 guarded request-body 边界生成；`onPayload` 不是所有 provider 的最终 seal。
- [verified] 当前 `acceptance:agent` 对 invalid/missing `--since` 会回退，Executor actor/reportDigest 预检不完整，且仓库内尚无绿色 Verifier/final report；RC-00 必须修复并用真实隔离 fixture 证明，不能只读源码宣布通过。
- [verified] 控制包结构、21 项契约测试、Task Forest 和 handoff 校验已通过；full-diff Harness 只因既有跨域脏改动被拒绝，不得扩大 owned paths。
- [verified] 控制包、Harness rule/spec、契约测试和 Task Forest proposal 当前仍是未提交工作树内容；进入正式工程验收前必须由获授权流程形成可复现 candidate SHA。

## 【任务森林状态】

- 相关全局目标：`TF-0010`。
- 新 proposal：`TFP-runtime-authority-convergence-20260802`，已由用户确认并在 2026-08-02 应用；控制包已激活（STATUS.md program_status=in_progress，current_work_package=RC-01）。
- `TF-0020`（RC-00）已由独立 Verifier 验收通过（VERDICT=pass）；`TF-0029`（RC-01）当前 ready。
- `TF-0017` 及其他真人 canary 必须移动到最终工程验收之后。
- Task Forest base hash 变化时重新生成 proposal，禁止 `--allow-stale`。

## 【已完成】

- 收敛章程、目标架构、串行工作包、工程验收和最终真人验收已持久化。
- Task Forest proposal 已应用：TF-0010 in_progress、TF-0013 blocked、TF-0017/18/19 deprecated、TF-0020 done、TF-0028(rc-program)..TF-0042(rc-10) 已创建。
- RC-00 完成并验收：acceptance:agent 修复了 invalid/missing `--since` fail-open（隐式 HEAD^ 默认已删除，catch-all fallback 已移除）、validateExecutorEvidence 新增 actor/digest 校验；隔离 fixture 产生真实绿色 executor/verifier/final report；22/22 单元测试；独立 Agent 复现 VERDICT=pass。证据在 `artifacts/agent-engineering-acceptance/rc-00-verifier-repro/final-report.json`。
- RC-01 完成：`artifacts/runtime-authority-convergence/rc-01/baseline.json` 已生成（schema v1、acceptedBaseSha、source/npm 版本、41 个 writer 全部分类、16/16 必含模块、runtime-family/runtime-spine 冻结、receipt-owner decision=accepted: `runtime_receipts` via `ReceiptStore` in openclaw-state SQLite）；`tests/unit/rc01-authority-inventory-baseline.test.ts` 6/6 通过。
- Receipt owner 决策已由用户确认（2026-08-02）：typed append-only `runtime_receipts` 表落在既有 openclaw-state SQLite，经窄 `ReceiptStore` 接口；`long_task_checkpoints` 与 RuntimeTaskEventLog 被否决并记录理由；七条硬约束已写入 baseline 与 TARGET-ARCHITECTURE。

## 【未完成 / 待验证】

- RC-01 决策更新后需要重新跑独立 Verifier；Verifier PASS 后更新 STATUS.md（blocker 移除、RC-01 记入 accepted_work_packages）与 Task Forest（TF-0029 done、TF-0030 ready）。
- RC-02 将实现 `runtime_receipts` 表 + `ReceiptStore`，做 full-payload shadow census（ShadowContextReceipt/v0 与 ShadowWireReceipt/v0，zero-byte parity，owner-classification coverage 100%，npm fallback 仅 degraded）。
- 后续 RC-03..RC-09 各包需要独立 Harness spec 与独立工程验收。

## 【关键文件 / 命令 / 产物】

- `docs/dev/unified-agent-system/runtime-convergence/`
- `C:\Users\27933\Desktop\result\final\dcs-first-architecture-synthesis-final-2026-08-02.md`
- `pnpm harness context --spec <active-spec>`
- `pnpm harness validate --spec <active-spec>`
- `node scripts/rc01-authority-inventory.mjs --accepted-base <RC-01 accepted base SHA>`（从固定基线重新生成 baseline）
- `node scripts/rc01-baseline-validate.mjs`（校验 baseline）
- `pnpm acceptance:agent:*`
- `.agent-workbench/task-forest/exports/task-forest.html`

## 【不要重复 / 不要做】

- 不继续 runtime-family、第二 event log、第二 Working Context store 或全字段 ContextUnit。
- 不引入 LangGraph、Temporal、OpenHands、LangSmith 或 Phoenix 进入核心。
- 不用增加 flag、provider、graph 节点或 UI 状态掩盖 authority 冲突。
- 不清理用户脏工作树，不回滚未授权修改，不并行推进 UI 收尾。

## 【下一步】

1. 读取 `STATUS.md`、Task Forest todo 和当前 git status。
2. 确认 proposal 已应用；未应用则只报告阻塞，不实施任何 RC 工作。
3. 应用后只执行 RC-00 acceptance bootstrap；invalid base 必须 fail closed，产物目录必须显式固定。
4. RC-00 accepted 后更新 STATUS/Task Forest，再由 RC-01 生成 authority inventory 和基线证据。

Mode: balanced. Privacy: local. Sources: current user requirements, Task Forest exports, workspace code/docs, six-agent DCS synthesis, and mainstream architecture research.
