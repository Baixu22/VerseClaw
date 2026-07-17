# Phase 6 — Supply Chain / Release Trust

Tier: M6→M7
Owner: supplychain-release
Findings: F-SUPPLY-001, F-SUPPLY-002, F-GOV-003
Dependencies: phase0-foundation, phase5-reliability-abuse

## Objective

建立可验证的 Windows 签名、更新、依赖完整性、SBOM 和 provenance。

## Task list

- P6-001 — Windows stable/prerelease 签名策略与发布阻断 — supplychain-release — F-SUPPLY-001
- P6-002 — AutoUpdater feed 注入、来源和篡改验证 — supplychain-release — F-SUPPLY-001
- P6-003 — Bundled binary、installer 与 Action 内容固定 — supplychain-release — F-SUPPLY-002
- P6-004 — SBOM、provenance、ASAR integrity 与 Electron fuses — supplychain-release — F-SUPPLY-002
- P6-005 — Clean release baseline 与可复现发布门禁 — program-governance — F-GOV-003

## Exit criteria

只有 clean、签名、可验证来源和完整门禁的产物可发布。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
