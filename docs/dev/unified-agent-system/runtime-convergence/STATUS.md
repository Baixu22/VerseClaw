---
schema: runtime-authority-convergence-status/v1
program_id: runtime-authority-convergence
task_forest_parent: TF-0010
task_forest_proposal: TFP-runtime-authority-convergence-20260802
program_status: in_progress
current_work_package: RC-00R
current_task_forest_node: TF-0020
engineering_verdict: not-run
engineering_report: null
human_verdict: not-run
human_verdict_record: null
done_allowed: false
required_work_packages:
  - RC-00
  - RC-01
  - RC-02
  - RC-03
  - RC-04
  - RC-05
  - RC-06A
  - RC-06B
  - RC-06C
  - RC-06D
  - RC-07
  - RC-08A
  - RC-08B
  - RC-09
  - RC-10
accepted_work_packages: []
product_locks:
  live_ready: false
  product_approved: false
  default_on: false
evidence_manifest: null
blockers:
  - independent-audit-no-go-fac6327a2
  - rc01-baseline-not-self-contained
  - rc02-through-rc08b-production-proof-incomplete
  - final-required-gates-not-green
  - independent-final-verifier-evidence-missing
  - rc00r-acceptance-control-plane-reverification-required
last_verified_at: 2026-08-03T22:05:00+08:00
next_action: RC-00R 是唯一 active package。本轮新增 finding RC00R-F1（`--no-diff` 移除不足以关闭审计发现）：harness/src/cli.mjs 仅在传入 `--since` 时开启 diff review，而 acceptance 的 harness-validate gate 未传；且 scenario-less spec 只走 id/title 分支，从不进入 ownedPaths 归属校验；getChangedFiles 还会把无效 base ref 吞成空列表。三处已修复并有反例测试（含 mutation 验证）。下一步：在 clean detached worktree 由不同 actor 运行新的 plan -> executor -> verifier evidence。fac6327a2 及其本地 evidence 只保留为 rejected historical input。RC-10 保持 blocked。
---
