---
id: verseshell-p0-governed-probe
title: VerseShell P0 Governed Real Probe and Approval Boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 以当前已验证的 VerseShell Windows x64 bundle 完成 VS-P0-03 真实 governed probe，证明 OpenClaw 审批拒绝、一次性批准重试、token 隔离、artifact 恢复和无 native fallback 的语义闭环。
touchedAreas:
  - harness/specs/tasks/verseshell-p0-governed-probe.md
  - harness/specs/rules/verseshell-foundation-p0-boundary.md
  - harness/specs/rules/verseshell-single-local-exec-canary-boundary.md
  - openclaw_runtime/src/agents/verseshell/**
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/verseshell-foundation/P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - 未通过 OpenClaw host policy 的 exec.run/process.start 保持 E_NEEDS_APPROVAL，不能消费 token 或执行命令。
  - 明确批准后只在 action-bound token 隔离的新 transport 中重试一次，动作完成后立即关闭批准 transport。
  - 输出受限并可通过 result:// artifact 句柄恢复；超时、协议、runtime、权限或命令失败均 fail-closed，不降级 native shell。
  - VerseShell 仍保持 default-off、liveReady=false、productApproved=false、defaultOn=false。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - contract-first-boundary
  - capability-owner-resolution
  - runtime-local-ecosystem-boundary
  - comms-regression
  - docs-sync
  - supply-chain-integrity-pinning
  - verseshell-foundation-p0-boundary
  - verseshell-single-local-exec-canary-boundary
forbiddenPatterns:
  - 将 E_NEEDS_APPROVAL 改写为 process-exit、protocol 或 generic failure
  - 在 OpenClaw policy 批准前使用或转发 runtime approval token
  - 使用父进程环境的 AETHER_APPROVE_ALL 或任意模型输入授予批准
  - 将 approved retry 复用到未批准 process 或重试 effectful action 超过一次
  - governed VerseShell 失败后切换 native shell、MCP、legacy eval 或其他 execution owner
  - 把本 probe、工程矩阵或 synthetic provider 结果解释为 canary、default-on、GA 或产品批准
featureFlags:
  - 仅复用现有 verifiedRuntime、typedAci、facade、governedExec gates；不新增默认开启路径。
  - 任何 rollout/product lock 保持关闭；kill switch 触发时 route 终止且不 fallback。
rollback:
  - 关闭 governed probe route 并保留原有 native owner；不得重放在途 effectful action。
  - 任何 binary、catalog、protocol、policy 或 workspace identity drift 立即拒绝执行。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p0-governed-probe.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p0-governed-probe.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm verseshell:test
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - 当前 resources/verseshell/manifest.json 指向的 verified Windows x64 ae.exe 完成真实 handshake、catalog、policy 和 capability 校验。
  - 真实 binary 在未批准请求中返回 E_NEEDS_APPROVAL；hostPolicyApproved=false 时 token 不被消费，且不会产生 native fallback。
  - host policy 明确批准后仅重试一次，retry 使用 action-bound token 的隔离 process；批准 process 在 action 完成后关闭。
  - 大输出被压缩为 bounded observation 并产生 result:// artifact；result.query 能恢复匹配内容和 metadata。
  - approved retry 及其 transport/protocol/runtime/command failure 均保持 fail-closed；不存在隐式 native fallback 或 effectful replay。
  - focused OpenClaw tests、real binary suite、bundle/runtime/package gates、typecheck 和 comms replay/compare 全部通过，或在 evidence 中逐项记录当前失败与环境 residual。
  - STATUS.md、编排计划和 handoff 明确区分当前工程 probe evidence 与真实 provider canary，不改变任何 product lock。
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P0 Governed Real Probe

本规范只负责 Task Forest `TF-0060` / VS-P0-03。它使用 VS-P0-02 已验证的 source/build
identity 和 Windows x64 binary，重新验证 governed approval 语义；不扩展 facade、MCP、
model tools、command profiles、写入、canary 或 rollout/product locks。

## 责任边界

- OpenClaw 继续拥有 command policy、approval、sanitized environment 和 action-bound token。
- ClawX Main/Electron 继续拥有 bundle identity、workspace、transport、diagnostics 和 kill switch。
- VerseShell 继续拥有 typed ACI 解码、policy/capability handshake、process lifecycle、bounded
  observation 和 artifact store。
- governed VerseShell route 的任何失败都终止本次调用；不得交给 native shell、legacy eval 或 MCP。

## Evidence policy

证据必须记录 candidate SHA、manifest/binary digest、命令、exit code、测试计数、artifact
handle 和 residual。该 probe 证明工程边界和真实本地 binary 行为，不证明 provider usage、
human recovery、paired A/B、soak、canary eligibility、default-on、GA 或产品批准。
