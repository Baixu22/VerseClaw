---
lifecycleStatus: active
id: coding-vs-execution-evaluation
title: TF-0777 VerseShell 编码执行、回执与清理
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 36897a4c5
intent: 以真实 Windows ae.exe、VG/STS/pytest 编码命令和 host-owned receipt authority 验证执行、取消、超时、重启、回执拒伪与 owned PID 清理。
touchedAreas:
  - harness/specs/tasks/coding-vs-execution-evaluation.md
  - tests/unit/coding-vs-evaluation.test.ts
  - scripts/coding-evaluation/verify-vs.py
  - scripts/coding-evaluation/test_vs_evidence.py
  - harness/specs/fixtures/coding-evaluation/TF-0777/**
expectedUserBehavior:
  - 真实 Windows process.start 的正常、超时、取消和后续重启均由现有 VerseShell lifecycle owner 管理，结束时只清理本 runner 创建的 PID。
  - VG/STS 编码验证通过指定 Python 解释器和目标 cwd 执行；selected pytest 结果与 STS plan 读回绑定，目标仓库和解释器身份不漂移。
  - live receipt 只有在 host observation、artifact、plan、candidate input、authorization 和 cleanup barrier 全部可复算时才被采纳；伪造 exit0、摘要错配、旧 candidate、晚到重复帧与 native fallback 均被拒绝。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
requiredTests:
  - VERSESHELL_REAL_PROCESS_START_LIMITS=1 corepack pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts src/agents/verseshell/governed-exec.real.test.ts src/agents/verseshell/governed-exec.real-limits.test.ts src/agents/verseshell/governed-process.real-limits.test.ts --maxWorkers=1
  - CODING_VS_EVALUATION=1 CODING_VS_OUTPUT=<new-absolute-directory> corepack pnpm exec vitest run tests/unit/coding-vs-evaluation.test.ts --maxWorkers=1
  - python -X utf8 -B scripts/coding-evaluation/test_vs_evidence.py
  - python -X utf8 -B scripts/coding-evaluation/verify-vs.py <report.json> --candidate <frozen-ClawX-commit> --expected-report-digest <retained-digest> --negative-checks
  - pnpm harness validate --spec harness/specs/tasks/coding-vs-execution-evaluation.md
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - 真实Windows父子进程正常/timeout/cancel/重启后按owned PID确认零存活，不操作未知PID。
  - 伪造exit0、摘要错配、旧candidate、晚到帧和native fallback不采纳。
  - STS目标解释器与cwd隔离正确，物化窗口到pytest执行、live receipt和证据封存/清理完成才结束。
  - 报告、命令输出、cleanup、负例和SHA-256均由独立验证器从磁盘复算；actor为agent且realHumanEvidence=false。
  - 节点读回与base_graph_hash匹配后自动收口；不改变产品锁、默认值或发布状态。
docs:
  required: false
  note: 本节点只新增评测合同与证据，不改变用户可见产品行为。
---

TF-0758/E3。运行仅使用 D 盘一次性目录；VG standalone、host-mode STS/pytest、固定 argv sidecar 与 receipt authority 保持各自职责。不扩大 M4、land/admit 或产品默认能力。