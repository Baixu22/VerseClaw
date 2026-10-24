# F3 long-session final acceptance

Source candidate: 5a14742d9a46cf6b626195bc29fd794603d4baec.

## Verdict

- PASS: true
- Executed nodes aggregated: 15 (A1-F2); this node (F3) supplies the aggregation evidence.
- Phases read from the plan: 6/6
- Node evidence OK: 15/15
- SHA256SUMS verified: 170 files across 15 node directories
- Recorded gate exit codes observed: 225, failed: 0
- Negative proof identifiers: 434

## Phase criteria

- TF-0542 (A): pass - **阶段一：统一会话动作并建立故障基线**：先固定逻辑会话、原生后端和资源的关系，让归档与恢复有可拒绝、可回读的生命周期保障。
- TF-0543 (B): pass - **阶段二：让会话配置与实际运行状态可见**：在现有入口说明当前后端、配置来源、授权、预算和不可用原因，复用已有模型生效能力事实。
- TF-0544 (C): pass - **阶段三：交付单工作区长期协调入口**：复用稳定 Assistant 和 Task Ledger，完成任务委派、接收回执、结果汇总与主会话续接；会话显式绑定 local checkout 或 worktree，绑定、handoff 与清理由宿主控制面持有。
- TF-0545 (D): pass - **阶段四：保持上下文连续性并评测策略**：消费唯一记忆与上下文控制面，测量跨压缩、交接和重启的关键事实保真度，再决定是否采用新策略。
- TF-0546 (E): pass - **阶段五：接通跟进调度与资源退出**：复用 Cron、Workboard 和各资源 owner，使暂停、取消、过期和重启不会产生重复执行或失控资源。
- TF-0547 (F): pass - **阶段六：完成长程自动验收与声明收口**：用跨重启旅程、长期加载和资源测量证明闭环，并将代码、配置、模型自述和验收范围对齐。

## Node evidence

| Node | Forest | Primary evidence | Gates | Failures | Negative proofs | SHA256 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | TF-0548 | harness/specs/fixtures/long-session-development/a1/gates.json | 10 | 0 | 17 | 7 |
| A2 | TF-0549 | harness/specs/fixtures/long-session-development/a2/gates.json | 32 | 0 | 17 | 20 |
| B1 | TF-0550 | harness/specs/fixtures/long-session-development/b1/gates.json | 17 | 0 | 15 | 20 |
| B2 | TF-0551 | harness/specs/fixtures/long-session-development/b2/gates.json | 14 | 0 | 29 | 19 |
| C1 | TF-0552 | harness/specs/fixtures/long-session-development/c1/gates.json | 15 | 0 | 48 | 17 |
| C2 | TF-0553 | harness/specs/fixtures/long-session-development/c2/gates.json | 17 | 0 | 36 | 10 |
| C3 | TF-0554 | harness/specs/fixtures/long-session-development/c3/gates.json | 17 | 0 | 18 | 12 |
| C4 | TF-0555 | harness/specs/fixtures/long-session-development/c4/gates.json | 15 | 0 | 3 | 15 |
| D1 | TF-0556 | harness/specs/fixtures/long-session-development/d1/verification.json | 24 | 0 | 70 | 14 |
| D2 | TF-0557 | harness/specs/fixtures/long-session-development/d2/verification-receipt.json | 12 | 0 | 110 | 8 |
| D3 | TF-0558 | harness/specs/fixtures/long-session-development/d3/verification-receipt.json | 4 | 0 | 4 | 4 |
| E1 | TF-0559 | harness/specs/fixtures/long-session-development/e1/verification-receipt.json | 15 | 0 | 51 | 11 |
| E2 | TF-0560 | harness/specs/fixtures/long-session-development/e2/verification-receipt.json | 2 | 0 | 3 | 6 |
| F1 | TF-0561 | harness/specs/fixtures/long-session-development/f1/restart-journey-results.json | 0 | 0 | 8 | 3 |
| F2 | TF-0562 | harness/specs/fixtures/long-session-development/f2/long-use-before-after.json | 31 | 0 | 5 | 4 |

## Claim boundary

- D2 evaluation status: EVIDENCE_INSUFFICIENT / NO-GO; live-provider quality claim allowed: false
- D3 continuity decision: keep-baseline
- Product semantics keep-baseline statement present: true
- README claim gaps: none
- Provider backend: scripted agent-driven endpoint only; no live-provider promotion claim

## Gates re-run on this candidate

- typecheck: exit 0 in 29717 ms
- contract-check: exit 0 in 938 ms
- comms-replay: exit 0 in 783 ms
- comms-compare: exit 0 in 693 ms
- repo-artifacts-check: exit 0 in 3939 ms
- repo-evidence-check: exit 0 in 649 ms
- long-session-e2e: exit 0 in 298620 ms
- harness-validate: exit 0 in 1313 ms
- git-diff-check: exit 0 in 72 ms

## Unmeasured

- non-Windows platforms: the aggregated runs executed on local Windows only
- live provider behaviour: D2/F2 used an agent-driven scripted endpoint, not a real provider, so no fidelity/cost promotion claim is made
- packaged/installed build: evidence comes from the local dist-electron development build
- real-human long-term usage: no real-human evidence is claimed or available
- public release, all-default enablement, product locks and a standalone multi-execution-root Project: not authorized by this node

All evidence is agent-driven (driven_by: agent, actor: codex-long-session-f3). No real-human evidence is claimed.
Public release, all-default enablement, product locks and a standalone multi-execution-root Project remain outside this node.
