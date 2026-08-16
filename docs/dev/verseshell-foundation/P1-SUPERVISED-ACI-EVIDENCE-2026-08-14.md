# VS-P1-01 受监督 ACI 证据

日期：2026-08-14  
Task Forest：`TF-0061` / VS-P1-01  
Scoped spec：[`verseshell-p1-supervised-aci.md`](../../../harness/specs/tasks/verseshell-p1-supervised-aci.md)  
Candidate（当前工作树 HEAD）：`98174768efeaba01b63f6623e12a91fded0fcd26`  
Base（HEAD 的父提交）：`3075bfcf799563984e1c5e857c65b08df6a7dc5b`

## 范围

本包只收敛 `VerseShellProcessManager`、`VerseShellAciClient` 和 governed process adapter 的
受监督生命周期语义。P0 已验证的 binary、catalog、policy、approval、artifact 和 default-off
边界保持不变；本包不启用 MCP、legacy eval、新 model tool、写入 journal、provider canary 或
任何 rollout/product lock。

## 实现结果

- process manager 明确暴露 `starting -> handshaking -> ready -> backoff/stopped/failed`。
- 每个请求由 host 生成 `requestId`，并绑定 `traceId`、绝对 `deadlineAt` 和 `processKey`；这些
  关联字段保留在受限 error/health metadata 中，不扩展未经 runtime schema 验证的 wire 字段。
- timeout、abort、spawn/handshake、协议 drift、process exit、restart exhaustion 和 kill switch
  均有稳定 code 与 bounded metadata；approval token、raw stderr 和命令内容不进入 metadata。
- `retryable` 只有在明确的只读幂等 operation allowlist 中才接受，并最多自动 retry 一次；
  effectful、写入和 unknown operation 会被 `E_ACI_RETRY_FORBIDDEN` 拒绝。进程崩溃时未发送的
  queued work 保留，过期条目显式以 timeout 拒绝，不会静默悬挂。
- `setKillSwitch` / `tripKillSwitch` 拒绝新 client、终止现有 transport、禁止 restart，并保持
  native shell、MCP、legacy eval fallback 关闭。
- governed lifecycle start、poll、stdin、EOF 和 kill 共享一个 host parent trace；owner、cursor、
  terminal cleanup、approval-scoped retry 和 no-effectful-replay 语义保持不变。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p1-supervised-aci.md` | PASS |
| `pnpm harness validate --no-diff --spec harness/specs/tasks/verseshell-p1-supervised-aci.md` | PASS；spec valid |
| `pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1 src/agents/verseshell/process-manager.test.ts` | PASS，24/24 |
| `pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1 src/agents/verseshell/governed-process.test.ts` | PASS，6/6 |
| `pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1 src/agents/verseshell` | PASS，11 files / 61 tests |
| `pnpm verseshell:test` | PASS：bundle 13/13，runtime-bundle 11/11，OpenClaw 57/57 |
| `pnpm run comms:replay` | PASS；写入 `artifacts/comms/current-metrics.json` |
| `pnpm run comms:compare` | PASS；message loss/duplicate/order violation 与 RPC timeout 均为 0，p95/throughput 在阈值内 |
| `git diff --check`（P1 scoped paths） | PASS |

| 补充验证 | 结果 |
|---|---|
| `pnpm run typecheck:node` | PASS；本次复跑未发现 node project 错误 |
| `pnpm run typecheck:web` | PASS |
| P1 scoped `pnpm exec eslint ...` | PASS；触及的五个 P1 runtime/test 文件无 error |
| P1 scoped `pnpm --dir openclaw_runtime exec oxlint ...` | PASS；仅有两个 warning（`unbound-method`、`await-thenable`），无 error |

完整 `pnpm run typecheck` 聚合入口在本候选中未能在 5 分钟窗口内完成，因此本证据使用其两个
项目门禁的直接复跑结果，不把聚合入口超时解释为通过。完整 `pnpm run lint:check` 同样在 5 分钟
窗口内未输出结果；scoped lint 结果仅证明 P1 touched areas。test project 的 observation-only
错误仍为非致命报告。该 residual 没有通过扩大 `touchedAreas`、修改无关 provider 代码或跳过规则
来掩盖。

Comms replay/compare 已在当前候选上复跑并通过。共享工作树的 diff-aware Harness ownership
检查仍可能因无关 changed paths 与 dry-run harness 依赖缺失阻断，不能以 `--no-diff` 结果冒充完整
候选验收。

## 错误/生命周期矩阵

| 场景 | 结果与 metadata |
|---|---|
| spawn/handshake failure | `E_ACI_SPAWN` / `E_ACI_PROTOCOL` / `E_ACI_TIMEOUT`，stage=`starting` 或 `handshaking` |
| response id/op mismatch | `E_ACI_PROTOCOL`，终止当前 transport，pending work 不重放 |
| request deadline/timeout | `E_ACI_DEADLINE` 或 `E_ACI_TIMEOUT`，带 request/trace/process/deadline |
| abort | `E_ACI_ABORTED`，终止当前 transport，不切换 owner |
| process crash/exit | `E_ACI_PROCESS_EXITED`，带 exitCode/signal/restartAttempt；effectful 不重放 |
| read-only retry | 仅 allowlisted `retryable` operation，最多一次；未知/副作用返回 `E_ACI_RETRY_FORBIDDEN` |
| restart budget exhausted | `E_ACI_RESTART_EXHAUSTED`，state=`failed` |
| operator kill switch | `E_ACI_KILL_SWITCH`，拒绝新请求并阻止 restart/fallback |

## 结论与残余

本证据证明 P1-01 的本地工程 contract、focused regression 和 VerseShell suite；它不证明 provider
usage、paired A/B、soak、人类 recovery、canary eligibility、default-on、GA、release 或产品批准。
必须继续保持 `default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。P1-02
（bounded observation/artifact/result query 的统一工作包）只有在本包 closeout proposal 应用后才解锁。
