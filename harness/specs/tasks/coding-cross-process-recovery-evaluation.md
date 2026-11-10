---
lifecycleStatus: active
id: coding-cross-process-recovery-evaluation
title: TF-0780 编码副作用跨进程崩溃与恢复一致性
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a11646b44a1018010c35b11ad2dc5044da58f4f5
intent: 在 intent、effect、materialize、validate、cleanup 五个真实进程窗口执行 kill/restart，复用现有 write journal、VS、VG/JJ、STS 和 Task Ledger owner，证明恢复只对账已发生效果，不重放或伪造完成。
touchedAreas:
  - harness/specs/tasks/coding-cross-process-recovery-evaluation.md
  - scripts/coding-evaluation/recovery-windows.mts
  - scripts/coding-evaluation/recovery.py
  - scripts/coding-evaluation/verify-recovery.py
  - scripts/coding-evaluation/test_recovery_evidence.py
  - harness/specs/fixtures/coding-evaluation/TF-0780/**
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 进程在编码事务任一关键阶段退出后，重启会读取已发生的文件、journal、Git/JJ、验证回执和 STS 范围，明确恢复或返回 unknown，不会静默重放。
  - 只有验证与回流均绑定同一候选时任务才进入完成；旧 epoch、重复完成、假 receipt 和清理残留保持拒绝。
requiredTests:
  - node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/coding-baseline/probes/journal-kill.mts
  - node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/coding-evaluation/recovery-windows.mts --output <new-json>
  - python -X utf8 -B scripts/coding-evaluation/test_recovery_evidence.py
  - python -X utf8 -B scripts/coding-evaluation/recovery.py --vg <vg.exe> --jj <jj.exe> --python <venv-python.exe> --contracts <vg-sts-contracts> --output <new-evidence-directory>
  - python -X utf8 -B scripts/coding-evaluation/verify-recovery.py <report.json> --candidate <frozen-ClawX-commit> --expected-report-digest <retained-digest> --negative-checks
  - corepack pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/apply-patch-consistency.test.ts src/agents/tools/write-journal.test.ts src/agents/apply-patch-effect-receipt.test.ts src/agents/subagent-registry.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/coding-cross-process-recovery-evaluation.md
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - intent、effect后receipt前、物化后验证前、验证后回流前、cleanup中五个窗口各至少3次真实子进程 kill/restart，不使用进程内 reset 冒充重启。
  - 每次恢复同run读回文件树、journal ref/phase、Git/JJ operation、VG candidate receipt、STS scope和Task Ledger终态；证明已发生效果与unknown分别处理。
  - 重复效果、丢用户修改、假终态、越界回收、旧epoch采纳均为0；重复恢复第二步restored为空。
  - 正常对照、cleanup清理与进程零存活成立；命令、exit、raw state和SHA-256由独立 verifier从磁盘复算。
  - 全部证据标 driven_by=agent、actor=codex-coding-recovery-evaluator、realHumanEvidence=false；不改变产品锁、默认值或发布状态。
docs:
  required: false
  readmeTranslations: not-required
---

TF-0758/F1。该叶只拥有评测驱动和证据，不创建第二恢复权威。文件 effect/undo 继续使用 `write-journal-core`，进程生命周期由现有 VS 能力与真实子进程 driver 检查；VG/JJ/STS 回执通过当前固定 CLI 与可执行环境读取。

五个窗口均在新 disposable workspace 内执行。parent agent 仅负责在 child 发出 stage 后发送真实 kill，并在新 child 中执行恢复读回。其他 worktree 中的未合入实现不进入本验收。
