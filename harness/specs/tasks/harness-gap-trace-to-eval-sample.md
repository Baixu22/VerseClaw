---
lifecycleStatus: completed
id: harness-gap-trace-to-eval-sample
title: 把脱敏失败轨迹转成可复跑评测样例（G03）
scenario: agent-dev-composable-scenarios
taskType: evaluation-harness
intent: G03 提供一个显式触发的转换器：把选定的脱敏失败轨迹转成可复跑评测样例（before-fix=fail / after-fix=pass），样例绑定有界 reproducer 与 selector，并拒绝任何未脱敏（raw prompt / 密钥 / auth 头）的轨迹，防止泄漏。不做定时 automation / 后台 daemon。
touchedAreas:
  - scripts/lib/trace-to-eval-sample.mjs
  - scripts/lib/trace-to-eval-sample.d.mts
  - tests/unit/trace-to-eval-sample.test.ts
  - harness/specs/tasks/harness-gap-trace-to-eval-sample.md
  - docs/dev/harness-gap-closure/g03-trace-to-eval-sample.md
  - docs/dev/harness-gap-closure/g03-acceptance.json
  - docs/dev/harness-gap-closure/G03-SHA256SUMS
ownedPaths:
  - scripts/lib/trace-to-eval-sample.mjs
  - scripts/lib/trace-to-eval-sample.d.mts
  - tests/unit/trace-to-eval-sample.test.ts
  - harness/specs/tasks/harness-gap-trace-to-eval-sample.md
  - docs/dev/harness-gap-closure/g03-trace-to-eval-sample.md
  - docs/dev/harness-gap-closure/g03-acceptance.json
  - docs/dev/harness-gap-closure/G03-SHA256SUMS
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/trace-to-eval-sample.test.ts
acceptance:
  - 一条真实失败轨迹 → 一个可复跑样例：before-fix 期望 fail、after-fix 期望 pass；成功/拒绝/取消轨迹保持 pass（修复不得回归）。
  - 样例绑定有界 reproducer（kind ∈ scenario|route|command-id，非 shell）与 selector（runId+attempt），含确定性 digest 供 replay 对比。
  - 拒绝未脱敏轨迹：出现 raw prompt/messages/body/authorization/apiKey/headers 或 sk-/phc_/ghp_/AKIA/私钥 等即整条拒绝，不写入样例（防泄漏）。
  - 显式触发批处理：仅转换调用方选定的轨迹（可对应最近 7 天 runIds），每个被拒轨迹单独留诊断；不新建定时 automation / daemon。
  - 不改产品默认值/锁/approval；不删除原始证据。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能显式地把一条脱敏失败轨迹沉淀成可复跑评测样例（修复前 fail、修复后 pass），未脱敏轨迹被拒绝而非泄漏。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/g03-trace-to-eval-sample.md
---

# G03 冻结实施边界

G03 只新增一个纯转换器 + 显式触发的批处理入口（`scripts/lib/trace-to-eval-sample.mjs`），把选定脱敏轨迹转成可复跑样例；不做定时 automation/daemon，不新建第二份 scenario registry（样例指向既有 agent-dev scenario/route/command-id）。未脱敏轨迹整条拒绝。
