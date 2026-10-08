---
id: verseshell-p2-command-profiles
title: VerseShell P2-02 argv-only Command Profiles
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将 OpenClaw 审批前已经解析的普通 coding 命令收敛为不可变 argv-only execution plan，并通过 VerseShell 统一承载 test、build、lint、git；显式用户终端脚本保留单独的解释器兼容边界。
touchedAreas:
  - harness/specs/tasks/verseshell-p2-command-profiles.md
  - harness/specs/rules/verseshell-command-profile-boundary.md
  - openclaw_runtime/src/agents/verseshell/command-profiles.ts
  - openclaw_runtime/src/agents/verseshell/command-profiles.test.ts
  - openclaw_runtime/src/agents/verseshell/shell-command.ts
  - openclaw_runtime/src/agents/verseshell/shell-command.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-gateway.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec-runtime.test.ts
  - tests/unit/verseshell-command-profiles.test.ts
  - docs/dev/verseshell-foundation/P2-COMMAND-PROFILES-EVIDENCE-2026-08-14.md
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - 普通 test、build、lint、git 命令在审批前由 OpenClaw 解析为 normalized argv，VerseShell 收到的 argv 与审批绑定的 argv 完全一致。
  - 普通命令默认不经过 cmd /C、PowerShell、Git Bash、sh -lc 或其他隐式 shell wrapper；模型不能选择 profile、interpreter、policy 或 approval token。
  - Windows PATH/PATHEXT、.exe/.com/.cmd/.bat、pnpm/npm/corepack、带空格和 Unicode 的 executable/cwd/argv 都有可验证的解析语义；cmd/bat 仅在显式、可审计的 interpreter profile 下运行。
  - 包含 pipeline、chain、redirect、heredoc、inline shell evaluation 或显式 shell interpreter 的用户终端 payload 不被伪装成 argv-only command；它保持单独的 shell-script policy/approval 边界。
  - cwd、sanitized env、timeout、output budget、artifact/result recovery 和 profile metadata 在 start 输入中保持有界且可审计；失败不切换 native fallback。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - renderer-main-boundary
  - verseshell-foundation-p0-boundary
  - verseshell-process-lifecycle-boundary
  - verseshell-command-profile-boundary
forbiddenPatterns:
  - approval 之后重新从 command 字符串解析或重建已绑定 argv
  - 普通命令默认包成 cmd /C、PowerShell -Command、Git Bash -lc 或 sh -lc
  - 通过 native shell、legacy eval、MCP 或其他 owner 隐式 fallback 掩盖 VerseShell 失败
  - 让模型直接选择 command profile、interpreter、PATH/PATHEXT、policy 或 approval token
  - 未审计的 cwd、环境变量、timeout、输出上限或 workspace 外写入路径
  - 把显式 shell-script payload 当成 argv-only 结果，或把外部写入宣称为 journal transaction
  - 修改 default-on、liveReady、productApproved、GA、provider canary 或 rollout 锁
featureFlags:
  - command profiles 复用既有 verifiedRuntime、typedAci、facade、governedExec gates，保持 default-off 和 kill-switch fail-closed。
  - profile 由 host 根据审批前 execution plan 推导；不增加模型工具参数或默认开启 flag。
rollback:
  - 关闭 governed command-profile route 时拒绝新请求或保留既有明确 owner；不得在 VerseShell 失败后自动切换 native shell。
  - 若 argv、executable identity、cwd/env、PATH/PATHEXT 或 policy provenance 不可验证，终止当前请求并返回 bounded failure。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p2-command-profiles.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p2-command-profiles.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/verseshell-command-profiles.test.ts --maxWorkers=1
  - pnpm run typecheck:node
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - P2-02 不改变共享四项 facade 顺序，也不把 command profile 暴露为模型工具；profile 只存在于 host-owned execution plan metadata。
  - 单段普通命令使用审批前 analysis segment 的 effective argv，VerseShell process.start/exec.run 直接接收同一 argv；审批后不得二次解释。
  - test/build/lint/git profile registry 覆盖 pnpm/npm/corepack、常见 runner、Git 和 Windows executable resolution，并限制 cwd/env/timeout/output 输入。
  - 显式 shell interpreter、pipeline、chain、redirect、heredoc 和 inline evaluation 保持独立的 shell-script policy/approval 语义，且不得伪装成 direct argv。
  - focused tests 覆盖 PATH/PATHEXT、.exe/.com/.cmd/.bat、spaces/Unicode、non-zero、timeout、large output、artifact recovery、kill switch 和 no-native-fallback。
  - evidence、STATUS 和三份 README 记录 engineering-only；P2-03 diagnostics、P3 writes、provider canary、default-on、GA 和 product approval 仍未授权。
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P2-02 argv-only Command Profiles

本包把 OpenClaw 已经完成的审批前命令分析转换为不可变的 host-owned execution plan。普通
coding 命令直接以 argv 进入 VerseShell；显式终端脚本仍是另一种有审批、有解释器身份的兼容
payload。P2-02 不负责写入 journal、provider canary 或 rollout 解锁。

## 责任边界

- OpenClaw 负责 command parsing、风险分析、allowlist、approval、profile 推导和 sanitized env。
- ClawX/Electron 负责 verified binary、workspace、policy profile、kill switch 和 host diagnostics。
- VerseShell 负责按 immutable argv/cwd/env/timeout/output plan 创建和监督 process，不重新解释 command string。
- shell interpreter 只有在用户显式提供 shell payload 且 policy 记录 interpreter identity 时可用。

## 证据政策

Evidence 必须记录 candidate/base SHA、spec/rule、命令和退出码、profile/argv 解析矩阵、Windows
resolver 结果、artifact/recovery、已知 dirty-worktree residual，以及 `default-off`、
`liveReady=false`、`productApproved=false`、`defaultOn=false`。工程门禁通过不等于 canary、GA
或产品批准。
