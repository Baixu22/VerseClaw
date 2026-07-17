# Phase 1 — Direct Boundary Closure

Tier: M1→M2
Owner: main-boundary
Findings: F-SEC-001, F-SEC-002, F-SEC-003, F-SEC-004, F-SEC-005, F-SEC-006, F-SEC-007, F-SEC-010
Dependencies: phase0-foundation

## Objective

关闭密钥、IPC、文件路径、协议和 Renderer/WebView 的直接外传边界。

## Task list

- P1-001 — Secret Broker 单源化与明文路径清除 — main-boundary — F-SEC-001,F-SEC-002
- P1-002 — Typed IPC、sender/session binding 与错误脱敏 — main-boundary — F-SEC-005
- P1-003 — Files Broker canonicalization 与 workspace root enforcement — main-boundary — F-SEC-004,F-SEC-006
- P1-004 — URL、openExternal、HTML Preview 与 WebView 单一策略 — main-boundary — F-SEC-003,F-SEC-007,F-SEC-010

## Exit criteria

直接泄露路径统一收口；默认协议/路径/密钥边界有负向测试。

## Phase rule

STATUS.json.phaseStatus=done 仅在全部 task status=done 后允许。
