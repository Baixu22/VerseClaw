# Phase 3 — Data Authority / Privacy

Tier: M3→M4
Owner: data-governance
Findings: F-DATA-001, F-DATA-002, F-DATA-003, F-DATA-004, F-DATA-005
Dependencies: phase2-authorization-isolation

## Objective

建立 raw data、知识、记忆、DCS 的 provenance、redaction、删除和 TTL 权威。

## Task list

- P3-001 — SEKB raw capture quarantine 与统一 redaction — data-governance — F-DATA-001,F-DATA-004
- P3-002 — DCS provenance、session lineage 与 confirm sink — data-governance — F-DATA-002,F-DATA-004
- P3-003 — Memory/COMPASS 双 gate 与污染撤销 — data-governance — F-DATA-003,F-DATA-004
- P3-004 — Session hard delete 级联、墓碑与 TTL — data-governance — F-DATA-005

## Exit criteria

canary 不落库；衍生数据可追踪、可撤销、可删除；检索注入有边界。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
