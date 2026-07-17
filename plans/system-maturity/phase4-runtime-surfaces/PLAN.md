# Phase 4 — Gateway / Browser / MCP / Channels

Tier: M4→M5
Owner: runtime-surfaces
Findings: F-AUTH-008, F-AUTH-009, F-SEC-007, F-REL-003, F-DATA-004
Dependencies: phase2-authorization-isolation, phase3-data-authority

## Objective

收口所有外部运行面，保证 Gateway、Browser、MCP、Channels 的策略真实执行。

## Task list

- P4-001 — Gateway method auth、Origin/CORS、rate limit 与 token exposure — runtime-surfaces — F-REL-003
- P4-002 — Agent Browser profile、tab、grant 与 filesystem boundary — runtime-surfaces — F-SEC-007,F-REL-003
- P4-003 — MCP runtime projection、schema、reload 与 secret broker — runtime-surfaces — F-AUTH-009,F-SEC-001
- P4-004 — Channels inbound trust、pairing/allowlist 与 webhook signature — runtime-surfaces — F-AUTH-008,F-SEC-001

## Exit criteria

外部请求具备认证、来源、速率、会话和权限绑定；工具/入站内容默认不可信。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
