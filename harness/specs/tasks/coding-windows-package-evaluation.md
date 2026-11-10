---
lifecycleStatus: active
id: coding-windows-package-evaluation
title: TF-0781 Windows 包内编码与 VG、STS、JJ 联合证据
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 87c9bbb9b62ef198f8b9cab35c9bda6e83545db4
intent: 从当前候选构建 Windows win-unpacked，使用三个独立用户 profile 运行真实 Electron/Gateway 编码、Git worktree、验证与 undo，并核对包内 VG、VerseShell、STS 契约和 JJ 工作区能力；默认不可用的外部解释器路径必须显式拒绝。
touchedAreas:
  - harness/specs/tasks/coding-windows-package-evaluation.md
  - vite.config.ts
  - tests/unit/vite-config-openclaw-runtime.test.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/coding-package-three-profiles.spec.ts
  - scripts/coding-evaluation/package-evaluation.py
  - scripts/coding-evaluation/verify-package-evaluation.py
  - scripts/coding-evaluation/test_package_evaluation.py
  - harness/specs/fixtures/coding-evaluation/TF-0781/**
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 未安装源码 checkout 的 win-unpacked 从包内资源和隔离用户目录启动，三个独立 profile 都能完成 coding、Git worktree、验证和 undo。
  - 包内 vg.exe、ae.exe 和 manifest 身份一致；VG 的 JJ 工作区与 STS 契约由包内二进制读取，缺少受支持 Python 或 managed-JJ 默认入口时返回明确拒绝。
  - 缺 binary、错误 hash、缺解释器、默认 off 和 cleanup 都留下可复算结果。
requiredTests:
  - corepack pnpm exec vitest run tests/unit/vite-config-openclaw-runtime.test.ts --maxWorkers=1
  - corepack pnpm run package
  - node scripts/run-electron-builder.mjs --win --x64 --dir --publish never --config.electronDist=<installed-electron-dist> --config.win.signAndEditExecutable=false
  - corepack pnpm verseshell:package:verify
  - CLAWX_PACKAGED_EXE=release/win-unpacked/Verse Claw.exe corepack pnpm exec playwright test tests/e2e/coding-package-three-profiles.spec.ts
  - python -X utf8 -B scripts/coding-evaluation/test_package_evaluation.py
  - python -X utf8 -B scripts/coding-evaluation/package-evaluation.py --package-root release/win-unpacked --raw-root <new-json-output> --output <new-evidence-directory> --build-package
  - python -X utf8 -B scripts/coding-evaluation/verify-package-evaluation.py <report.json> --candidate <frozen-ClawX-commit> --expected-report-digest <retained-digest> --negative-checks
  - pnpm harness validate --spec harness/specs/tasks/coding-windows-package-evaluation.md
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - 三个 fresh profile 各自从 win-unpacked 启动 Electron、Gateway 和 coding worktree，完成写入、验证、回流与 undo；源码目录不进入运行时搜索路径。
  - 包内 vg.exe、ae.exe、manifest、STS 1.1/2.0 声明和 JJ workspace/op 能力与当前候选绑定；缺 binary、错 hash、缺解释器及不支持默认入口均有负例结果。
  - 正常与负例命令、exit、stdout/stderr、包与配置摘要、文件读回、进程清理和 SHA-256 由独立 verifier 从磁盘复算。
  - 所有证据标 driven_by=agent、actor=codex-coding-package-evaluator、realHumanEvidence=false；安装器保持 not-run，产品锁、默认值和发布权限不变。
docs:
  required: false
  readmeTranslations: not-required
---

本轮使用当前候选构建的 `win-unpacked`。三个 profile 使用不同的 userData、HOME、OpenClaw state 和 disposable workspace；每个 profile 都从同一包二进制启动，完成 coding worker、Git worktree、验证、回流和 undo。VG、VerseShell 与 STS 契约从包内资源读取；未随包提供的 Python STS 执行环境和 managed-JJ 默认入口作为显式不可用结果记录。安装器不执行。
