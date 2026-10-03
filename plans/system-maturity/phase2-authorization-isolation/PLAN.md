# Phase 2 — Authorization / Isolation Kernel

Tier: M2→M3
Owner: runtime-auth
Findings: F-AUTH-001, F-AUTH-002, F-AUTH-003, F-AUTH-004, F-AUTH-005, F-AUTH-006, F-ISO-001, F-ISO-002, F-REL-003
Dependencies: phase1-direct-boundaries

## Objective

建立 Model proposes, Monitor decides 的硬授权与隔离内核。

## Task list

- P2-001 — Workspace Restricted Mode 与 acceptEdits 收紧 — runtime-auth — F-AUTH-001
- P2-002 — Approval queue 原子消费与 replay 防护 — runtime-auth — F-AUTH-006
- P2-003 — Role、readPaths/writePaths 与子 Agent 权限硬执行 — runtime-auth — F-AUTH-002
- P2-004 — Sandbox backend 失败时高危动作 fail-closed — runtime-auth — F-ISO-001,F-ISO-002
- P2-005 — CVK、Runtime Spine、Verifier 门控 API 与生产执行边界 — runtime-auth — F-AUTH-003,F-AUTH-004,F-AUTH-005

P2-005 的 2026-07-17 交付是历史 API/单元证据；当前 `F-AUTH-003` 为 `Partial`，生产 CVK 执行边界仍是后续默认关闭任务，不能从本 phase 的历史 `done` 记录推导出生产硬阻断已启用。

## Exit criteria

审批、角色、sandbox、CVK/Spine/Verifier 均能真实 deny/ask/allow；高危降级 fail-closed。

说明：这是 phase 的最终出口，不是 P2-005 当前交付状态。P2-005 已证明门控 API、Spine 默认和 Verifier 行为；CVK 生产工具执行边界尚未消费 `denied`，因此该 phase exit criterion 对 CVK 仍未满足。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
