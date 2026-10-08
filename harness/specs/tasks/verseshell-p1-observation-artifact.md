---
id: verseshell-p1-observation-artifact
title: VerseShell P1 Bounded Observation and Artifact Recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将 VerseShell 的 stdout/stderr/JSON/observation 上限、截断 metadata、artifact lineage、result.query 和 recovery/expiry 语义统一为可验证、默认关闭、fail-closed 的结果契约。
touchedAreas:
  - harness/specs/tasks/verseshell-p1-observation-artifact.md
  - shared/verseshell/types.ts
  - shared/verseshell/validation.ts
  - shared/verseshell/extraction.ts
  - shared/verseshell/errors.ts
  - shared/verseshell/index.ts
  - openclaw_runtime/src/agents/verseshell/normalizer.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - openclaw_runtime/src/agents/verseshell/result-tool.ts
  - openclaw_runtime/src/agents/verseshell/normalizer.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.test.ts
  - openclaw_runtime/src/agents/verseshell/result-tool.test.ts
  - shared/verseshell/validation.test.ts
  - shared/verseshell/extraction.test.ts
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/verseshell-foundation/P1-OBSERVATION-ARTIFACT-EVIDENCE-2026-08-14.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - VerseShell 保持 default-off；未同时建立 verified runtime、policy、protocol、workspace 和 artifact identity 时，结果查询拒绝并 fail-closed。
  - stdout、stderr、JSON frame 和 observation 都有独立上限；超过上限时 observation 明确报告 truncated、omitted bytes 和可恢复 artifact，不能静默丢失。
  - artifact handle、sha256、stream、raw/retained/omitted bytes、created/expiry、owner/process lineage 和 query capabilities 经过严格验证；敏感原文只存在于受限 artifact，不进入无界模型可见结果。
  - result.query 只支持 meta/head/tail/slice/grep/raw 的 bounded 参数；handle、digest、owner、expiry、mode 或 response contract 不匹配时返回稳定错误且不重试 effectful action。
  - runtime 重启后只允许查询仍在 retention 内且 identity 可验证的 artifact；过期、丢失、损坏或 owner drift 明确分类，不伪装成空结果或成功恢复。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - contract-first-boundary
  - comms-regression
  - docs-sync
  - release-artifact-attestation-integrity
  - verseshell-foundation-p0-boundary
  - verseshell-process-lifecycle-boundary
forbiddenPatterns:
  - 以字符串拼接或未经验证的任意 JSON 将 artifact 句柄交给模型
  - 超过 stdout/stderr/JSON/observation 上限后静默截断、覆盖 omitted metadata 或丢弃 artifact lineage
  - result.query 接受无界 raw、无界 grep、路径穿越、任意文件路径或未经验证的 digest
  - artifact 过期、丢失、损坏、owner/process mismatch 或 response id/op mismatch 时返回 ok=true 或空成功结果
  - 通过 native shell、MCP、legacy eval 或 effectful replay 绕过 artifact/result contract
  - 将 approval token、原始命令、credential、完整 stderr 或无限日志写入 observation metadata
featureFlags:
  - 仅复用现有 verifiedRuntime、typedAci、facade、governedExec、artifactResults 和 killSwitch；不新增默认开启路径。
  - kill switch 或任一 identity/contract mismatch 必须拒绝结果查询并保持既有 owner，不自动 fallback。
rollback:
  - 关闭 artifactResults/result.query route，保留 P1-01 lifecycle owner；不得删除仍在 retention 内的既有 artifact，也不得重放 effectful 请求。
  - 若新 lineage 字段无法由当前 runtime 严格验证，回退到拒绝该 observation，而不是猜测或降级为未绑定文本。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p1-observation-artifact.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p1-observation-artifact.md
  - pnpm exec vitest run --config vitest.agent-dev.node.config.ts shared/verseshell/validation.test.ts shared/verseshell/extraction.test.ts
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1 src/agents/verseshell/normalizer.test.ts src/agents/verseshell/governed-exec.test.ts src/agents/verseshell/result-tool.test.ts
  - pnpm verseshell:test
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - shared observation/artifact types define bounded stream metadata, omitted bytes, retention/expiry, owner/process lineage and supported query modes without changing the JSONL request wire contract.
  - validators reject malformed handles, invalid digest/byte/count/expiry fields, unbounded query parameters, unknown artifact ownership and schema drift; they preserve stable transport/lifecycle/contract/business error categories.
  - normalizer and governed execution expose only bounded/redacted artifact projections; stdout/stderr formatting retains artifact references and truncation evidence without leaking raw command or approval data.
  - result.query validates handle and every mode-specific bound before transport, returns bounded data or a stable classified error, and never falls back to another execution owner.
  - focused/shared tests cover oversized stdout/stderr/JSON/observation, artifact creation and handle extraction, truncation/omitted bytes, meta/head/tail/slice/grep/raw bounds, expiry/missing/digest mismatch, restart query and kill-switch denial.
  - scoped Harness, VerseShell suite, direct node/web typecheck, comms replay/compare and diff check pass; full aggregate gate timeouts or shared-worktree ownership residuals remain explicitly recorded and do not become release/canary evidence.
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

# VerseShell P1-02 Bounded Observation and Artifact Recovery

本规范只负责 Task Forest `TF-0062` / VS-P1-02。它承接 P1-01 已验证的 process owner、request
correlation 和 fail-closed 生命周期，但不新增模型工具、不改变 JSONL request wire contract，
也不启用 MCP、legacy eval、写入 transaction、provider canary 或任何 rollout/product lock。

## 责任边界

- VerseShell runtime 继续拥有原始 stream capture、artifact retention 和 result.query 执行。
- OpenClaw/shared contract 只负责严格 decode、bounded projection、error taxonomy 和 facade 语义。
- ClawX Main 继续拥有 verified binary、workspace identity、host diagnostics 和 operator kill switch。
- artifact 查询不能通过路径、环境变量、native shell 或 MCP 绕过 runtime owner；无法证明 identity
  时必须拒绝。

## 证据政策

Evidence 必须记录 candidate/base SHA、spec/rule、命令和退出码、每个 bounds/error/recovery 场景
的结果、敏感字段投影检查、共享工作树 residual，以及 `default-off` / `liveReady=false` /
`productApproved=false` / `defaultOn=false`。工程门禁通过不等于 provider usage、canary、GA 或
产品批准。
