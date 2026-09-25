---
schema: runtime-authority-convergence-status/v1
program_id: runtime-authority-convergence
task_forest_parent: TF-0010
task_forest_proposal: TFP-runtime-authority-convergence-20260802
program_status: in_progress
current_work_package: RC-09
current_task_forest_node: TF-0041
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
accepted_work_packages:
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
product_locks:
  live_ready: false
  product_approved: false
  default_on: false
evidence_manifest: null
blockers: []
last_verified_at: 2026-09-25T21:00:00+08:00
next_action: 程序回到 in_progress：2026-08-09 那一代 RC-09 证据（candidate 3209f0981）已随 fac6327a2 世代一起被判 rejected/historical，见 TFD-RC09-HISTORICAL-20260803；它已归档到 artifacts/runtime-authority-convergence/rc-09/rejected-20260809/，不再作为绿色证据，因此这里不再声明 human_acceptance_pending。RC-00R..RC-08B 已在共享集成分支 feat/runtime-lifecycle-governance 上串行复验完毕并逐个独立 Verifier 通过，故仍列在 accepted_work_packages；RC-09 与 RC-10 不在其中。RC-09 的两个所有权阻塞已于 2026-09-25 解除（TFD-RC09-SCOPE-20260925，方案 B：归属口径改为 RC-owned ∪ 具名排除，acceptedBaseSha 前移到 1cddcb1ba），工程重跑已按 ACCEPTANCE.md 的 PowerShell 流程启动：plan 通过（23 门、cleanAtPlan=true、changedPaths=241、矩阵零缺失），executor 首轮因环境缺少固定 Rust toolchain 1.94.0 在 provision-verseshell-resources 失败，改用 RUSTUP_TOOLCHAIN=1.94.0-x86_64-pc-windows-msvc 后通过该门；第二轮停在 fast-unit-tests（2 个既有红测试：runtime-authority-convergence-control-pack 依赖本文件旧状态、uas-05 把 TF-0041 硬编码为 proposed），修复中。product locks 保持 false——任何状态都不改变 default-on/release/GA/TF-0006。
---
