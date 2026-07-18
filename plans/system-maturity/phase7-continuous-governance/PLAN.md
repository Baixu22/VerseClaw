# Phase 7 — Continuous Governance / Maturity

Tier: M7→continuous
Owner: program-governance
Findings: F-GOV-001, F-GOV-002, F-GOV-003, F-UX-002
Dependencies: phase6-supply-release

## Objective

把成熟度变成持续运行的控制系统，而不是一次性修复。

## Task list

- P7-001 — Finding 到测试、代码、证据的双向追踪 — program-governance — F-GOV-001,F-GOV-002
- P7-002 — 安全红队与故障注入长期套件 — qa-governance — F-SEC-003,F-SEC-006,F-AUTH-006,F-DATA-005,F-REL-001,F-REL-004,F-SUPPLY-001
- P7-003 — 隐私、遥测、clipboard/screenshot/desktop automation 控制 — privacy-governance — F-DATA-004,F-DATA-005,F-UX-002
- P7-004 — 季度成熟度审计与阶段复审机制 — program-governance — F-GOV-002,F-GOV-003

## Exit criteria

每次变更自动评估 Finding、证据新鲜度、回归门禁和发布资格。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
