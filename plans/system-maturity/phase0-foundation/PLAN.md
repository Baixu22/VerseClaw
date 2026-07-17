# Phase 0 — Foundation / Evidence Control

Tier: M0→M1
Owner: program-governance
Findings: F-GOV-001, F-GOV-002, F-GOV-003, F-REL-004
Dependencies: none

## Objective

建立单一审计基线、任务注册、证据链和硬门禁。

## Task list

- P0-001 — 冻结审计基线与 Finding 注册表 — program-governance — F-GOV-003,F-GOV-002
- P0-002 — 建立阶段任务注册与状态机 — program-governance — F-GOV-002
- P0-003 — 收紧测试门禁与全量/快速循环边界 — qa-governance — F-GOV-001,F-GOV-002
- P0-004 — 建立证据交付与审计回归自动化 — qa-governance — F-GOV-002,F-GOV-003

## Exit criteria

所有任务验收通过；状态机、证据索引和 CI 门禁可重复执行。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
