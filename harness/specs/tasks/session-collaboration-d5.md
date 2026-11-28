---
lifecycleStatus: active
id: session-collaboration-d5
title: D5 复核会话索引的重开条件
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5fa4849771af7e035dc121c7ffb6ea984abbdfd3
intent: 回读 A5 规模和 D4 协作对照，确定实际消费方的查询缺口与索引证据。
touchedAreas:
  - harness/specs/tasks/session-collaboration-d5.md
  - harness/specs/fixtures/session-collaboration-center/D5/review-evidence.mjs
  - harness/specs/fixtures/session-collaboration-center/D5/review-evidence.test.mjs
  - harness/specs/guides/session-collaboration-center-plan.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - backend-communication-boundary
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 复核报告展示各会话规模的延迟、扫描量和成对测量覆盖率。
  - 样本不足、查询越界或候选不符时，复核报告列出对应的证据缺口。
requiredTests:
  - node --test harness/specs/fixtures/session-collaboration-center/D5/review-evidence.test.mjs
  - node harness/specs/fixtures/session-collaboration-center/D5/review-evidence.mjs <A5-scale-raw-samples.json> <D4-benefit-raw-pairs.json>
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-d5.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-d5.md --dry-run
acceptance:
  - 回读 A5、D4 同候选原始样本并分别复算延迟、扫描量、配对覆盖和消费结果。
  - TF-0647 的历史决定可回溯；使用真实查询缺口、具体消费者失败或可重建证据核对原重开条件。
  - 根据实测形成 GO 或 NO-GO，GO 时为可重建索引单独建立写集、owner 和验收入口。
docs:
  required: true
  files:
    - harness/specs/guides/session-collaboration-center-plan.md
---
# D5 索引证据

将 A5 的 `scale-raw-samples.json` 和 D4 的 `benefit-raw-pairs.json` 传给证据复核脚本。它重新计算规模和配对汇总，检查候选、原始哈希及只读约束，并保留不完整来源。按 A5 每档 20 次规模采样和 D4 固定对照组数核验覆盖率。报告分别记录列表和详情的扫描量。A5 合成会话规模与 D4 脚本化请求分别标识。

核对 TF-0647 第五节的三项重开条件。消费方以真实 UI 或工具查询及其具名回执为依据，重建依据来自原 SessionStore 和负责该写集的 owner。裁定记录与工程实现分别交付，本入口只读取实测文件。
