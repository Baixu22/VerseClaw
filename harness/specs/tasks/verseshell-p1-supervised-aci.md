---
id: verseshell-p1-supervised-aci
title: VerseShell P1 Supervised ACI Lifecycle
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将 VerseShellProcessManager 与 VerseShellAciClient 收敛为可审计、可恢复、默认关闭的受监督执行内核，明确生命周期、请求关联、稳定错误、只读重试和 kill switch 语义。
touchedAreas:
  - harness/specs/tasks/verseshell-p1-supervised-aci.md
  - harness/specs/rules/verseshell-process-lifecycle-boundary.md
  - openclaw_runtime/src/agents/verseshell/aci-client.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/verseshell-foundation/P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - VerseShell 继续保持 default-off；未建立 verified runtime、policy、protocol 和 workspace identity 时执行被拒绝。
  - 每个请求有 host 生成且不可由模型覆盖的 requestId、traceId、deadline 和 processKey；响应 id/op/上下文不匹配时 fail-closed。
  - 生命周期可观察为 starting -> handshaking -> ready -> backoff/stopped/failed，崩溃、超时、取消和重启返回稳定错误码与受限 metadata。
  - 只有明确标记为只读且幂等的请求可以在受控 transport 重启后重试；effectful 或未知副作用请求绝不自动重放。
  - operator kill switch 停止新请求并终止在途请求，失败时不切换 native shell、MCP 或 legacy eval。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - contract-first-boundary
  - runtime-local-ecosystem-boundary
  - comms-regression
  - docs-sync
  - supply-chain-integrity-pinning
  - verseshell-foundation-p0-boundary
  - verseshell-process-lifecycle-boundary
forbiddenPatterns:
  - 从模型 args、runtimeEnv 或继承环境读取 requestId、traceId、approval token、policy 或 kill-switch 授权
  - response id/op/context 不匹配时继续交付 observation 或重放请求
  - 对 process.start、process.write、process.kill、exec.run 或未知 operation 自动重试
  - timeout、cancel、crash、protocol drift 或 kill switch 后切换 native shell、MCP、legacy eval 或其他 execution owner
  - 将原始 stderr、approval token、完整命令或无限日志写入模型可见诊断
  - 将工程生命周期证据解释为 canary、default-on、GA 或产品批准
featureFlags:
  - 仅复用现有 verifiedRuntime、typedAci、facade、governedExec gates；不新增默认开启路径。
  - kill switch 触发时拒绝新请求、终止在途请求并保持 fail-closed；所有 rollout/product locks 保持关闭。
rollback:
  - 关闭 supervised ACI route，保留既有 owner；不得重放在途 effectful action。
  - 若 request context、lifecycle metadata、protocol 或 binary identity 无法验证，终止当前 process 并要求重新建立 transport。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p1-supervised-aci.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p1-supervised-aci.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1 src/agents/verseshell/process-manager.test.ts
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1 src/agents/verseshell/governed-process.test.ts
  - pnpm verseshell:test
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - process manager 在 start、handshake、ready、backoff、stopped、failed 各阶段有确定状态转换；failed start 不发布可用 client。
  - 每个 outbound request 绑定 requestId、traceId、deadlineAt 和 processKey；runtime 收到的字段不可由调用方覆盖，response id/op/context drift 统一映射为协议错误并终止 transport。
  - timeout、abort、process exit、spawn/handshake failure、backoff exhausted 和 kill switch 分别保留稳定 code、stage、requestId、traceId、processKey、deadline、exitCode/signal 与 restartAttempt；诊断经过 bounded/redacted projection。
  - 只读幂等请求在 transport restart 后最多按策略重试且保持同一语义；effectful、写入和 unknown 请求恰好只发送一次并在不确定时拒绝。
  - health/list 与 operator kill switch 可查询并控制 process；kill switch 后新旧请求都 fail-closed，manager 不自动启用 native fallback。
  - 现有 governed process 的 owner、cursor、stdin、EOF、terminal cleanup 和 approval-scoped retry 语义无回归。
  - focused tests、VerseShell suite、typecheck、comms replay/compare 和 diff check 全部通过；所有 residual、dirty-worktree 限制和非 GA 结论记录在 evidence。
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
    - docs/dev/verseshell-foundation/P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P1 Supervised ACI

本规范只负责 Task Forest `TF-0061` / VS-P1-01。它在已完成的 P0 source、binary、policy、
approval 和 artifact 边界上补齐受监督 execution kernel；不启用 default-on、MCP、legacy eval、
新 model tool、写入 journal 或真实 provider canary。

## 责任边界

- OpenClaw 继续拥有 command policy、approval、sanitized environment 和 effect classification。
- ClawX Main/Electron 继续拥有 verified binary、workspace identity、operator kill switch 和 host diagnostics。
- VerseShell process manager 继续拥有 child process、JSONL transport、生命周期、请求队列和 bounded transport metadata。
- Governed process adapter 只负责把 OpenClaw lifecycle operation 映射为 owner-bound typed calls；它不能私自 spawn、重放 effectful action 或提供 native fallback。

## 证据政策

Evidence 必须记录 candidate/base SHA、spec/rule、命令和退出码、focused test 计数、生命周期与错误矩阵、
残余环境限制，以及 `default-off` / `liveReady=false` / `productApproved=false` / `defaultOn=false`。
工程门禁通过不等于 canary 资格、provider usage、GA 或产品批准。
