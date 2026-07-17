# Phase 5 — Reliability / Abuse Resistance

Tier: M5→M6
Owner: reliability
Findings: F-REL-001, F-REL-002, F-REL-005, F-UX-001, F-GOV-001
Dependencies: phase0-foundation, phase2-authorization-isolation

## Objective

消除双真相、非原子写、无限增长、重复执行和资源滥用。

## Task list

- P5-001 — 关键配置原子提交与跨进程一致性 — reliability — F-REL-002
- P5-002 — Cron 单一权威、跨进程 lease 与重复执行防护 — reliability — F-REL-001
- P5-003 — 日志轮转、保留、脱敏与故障可见性 — reliability — F-REL-005,F-DATA-004
- P5-004 — Agent turn、token、cost、history 与资源上限 — reliability — F-UX-001

## Exit criteria

关键状态单源、写入可恢复、资源有上限、跨进程行为可证明。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
