# Future Default-On Implementation Spec Template

Use this only after this readiness package reaches `ready_for_default_on_implementation_spec`.

```markdown
---
id: phase-line-b-agentmap-default-on-implementation
title: Line B AgentMap Default-On Implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a gated default-on AgentMap path only after accepted readiness proof.
prerequisites:
  - phase-line-b-agentmap-default-on-implementation-readiness is ready_for_default_on_implementation_spec
forbiddenUntilApproved:
  - production-ready declaration
  - default cutover approval
  - provider ordering changes
  - candidate persistence
  - renderer direct IPC/Gateway
  - service/listener/database/server additions
requiredTelemetry:
  - leakage_count
  - provider_ordering_drift
  - reviewer_prompt_byte_drift
  - fail_closed_count
  - rollback_success
  - persistence_count
  - authority_escalation
requiredRollback:
  - close any AgentMap flag
  - omit explicit/default gate
  - fail closed on invalid/missing/malformed AgentMapResult
requiredTests:
  - focused default-path parity tests
  - sentinel leakage tests
  - provider ordering tests
  - persistence tests
  - comms replay/compare if communication paths are touched
---

# Line B AgentMap Default-On Implementation

This future task must start from the accepted readiness proof and must still separate implementation from production cutover.
```
