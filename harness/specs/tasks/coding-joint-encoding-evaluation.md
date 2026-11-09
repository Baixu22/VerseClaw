---
lifecycleStatus: active
id: coding-joint-encoding-evaluation
title: TF-0779 Git、VG、JJ、STS 同候选联合编码对拍
scenario: versegit-validation-layer-extension
taskType: evaluation
diffBase: 406bd51e494b2b2210a2e23f3124be415e7f8649
intent: 在同任务、同输入、同依赖和同候选下执行 Git/原生工具/full、VG/JJ/full、VG/JJ/STS selected+final-full 三臂对拍，覆盖冲突、跨文件依赖、删除、stale、dirty、恢复与证据错配，并独立复算质量、成本、树和清理。
ownedPaths:
  - harness/specs/tasks/coding-joint-encoding-evaluation.md
  - scripts/coding-evaluation/joint.py
  - scripts/coding-evaluation/verify-joint.py
  - scripts/coding-evaluation/test_joint_evidence.py
  - harness/specs/fixtures/coding-evaluation/TF-0779/**
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles: []
expectedUserBehavior:
  - 单个组件通过但组合错误、候选错配、旧 basis、冲突或中途取消不能被最终联合通过掩盖。
  - 三臂使用同一任务、输入、依赖和候选身份，最终文件树、验证结果、清理回执与成本都有独立读回。
  - 支持域内的 Git、VG/JJ、STS 和 VerseShell 执行路径保持一致；不支持组合显式记录。
requiredTests:
  - python -X utf8 -B scripts/coding-evaluation/test_joint_evidence.py
  - <eval-python-with-psutil-7.0.0> -X utf8 -B scripts/coding-evaluation/joint.py --help
  - <eval-python-with-psutil-7.0.0> -X utf8 -B scripts/coding-evaluation/joint.py --vg <current-vg.exe> --jj <pinned-jj.exe> --python <python> --workspace-a <fixture-a> --workspace-b <fixture-b> --output <new-evidence-directory>
  - python -X utf8 -B scripts/coding-evaluation/verify-joint.py <report.json> --candidate <frozen-ClawX-commit> --expected-report-digest <retained-digest> --negative-checks
  - corepack pnpm exec vitest run tests/unit/orchestration-worktree-merge.test.ts tests/unit/uas-04-coding-mutation-consistency.test.ts --maxWorkers=1
  - cargo test -p vg-cli --test jj_cross_workspace_conflict --test jj_conflict_gate --test jj_transaction_recovery --test jj_sts_feedback
  - pnpm harness validate --spec harness/specs/tasks/coding-joint-encoding-evaluation.md
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - 两个独立 workspace 各执行 3 次 A/B/C；A、B、C 共享任务输入、依赖身份、候选内容和 oracle，所有最终树与预期结论从盘上复算。
  - 覆盖同文件竞争、跨文件依赖、rename/delete、stale basis、dirty 保留、组合 candidate、取消与恢复；planted 错误必须被 combined full 或语义 oracle 拒绝。
  - selected 只触发选中执行，最终 full 仍必须执行；selected 漏掉 full 失败时记录 missed 并拒绝通过。
  - 报告正确性、漏报、误报、冲突、恢复、wall、CPU、RSS、环境成本；scripted 路径的 token 明确不适用，不声明 live model quality。
  - 命令、exit、输出、树、进程、清理、环境和 SHA-256 由独立 verifier 复算；篡改、旧 candidate、删除负例、selected 升格和假清理均拒绝。
  - 全部证据标 driven_by=agent、actor=codex-coding-joint-evaluator、realHumanEvidence=false；不改变产品锁、默认值或发布状态。
docs:
  required: false
  readmeTranslations: not-required
---

TF-0758/E5。该叶只拥有联合评测驱动、独立 verifier、单体测试和证据，不新增第三套 Git/JJ/VG/STS 执行或恢复权威。复用 TF-0776 的 Git/JJ parity、TF-0777 的 VerseShell 执行回执、TF-0778 的 STS selection 结果以及现有 ClawX/VG 入口。

两个 workspace 使用固定 Python fixture 和独立 session 标识。每轮从同一 base tree 创建 disposable 副本，A/B/C 的输入内容和依赖身份逐项相同。scripted runner 不连接 provider；模型 token 记为 not-applicable，只有实际 live endpoint 与 attribution 才能用于模型质量结论。
