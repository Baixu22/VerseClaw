---
lifecycleStatus: active
id: network-reliability-fault-injection-v1
title: Independent fault-injection acceptance for network reliability
scenario: gateway-backend-communication
task_forest:
  - TF-0444
taskType: runtime-bridge
intent: Prove retry budgets, Gateway reconnection, provider circuit breaking, stream failure isolation and deadline cancellation with repeatable agent-driven fault injection.
touchedAreas:
  - scripts/network-reliability-fault-injection.mjs
  - harness/specs/tasks/network-reliability-fault-injection-v1.md
  - artifacts/network-protocol-reliability/net-g/**
expectedUserBehavior:
  - 故障注入结果可直接复核哪些可靠性承诺已通过、哪些仍未验证。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - comms-regression
  - provider-error-retry-boundaries
  - error-governance-boundary
humanEvidence: not-required
requiredTests:
  - node scripts/network-reliability-fault-injection.mjs
  - pnpm run typecheck
acceptance:
  - Fault injection covers Gateway seq gap/reconnect/resubscribe, provider 429/503/open/half-open, mid-stream failure and deadline/cancel.
  - Report contains candidate SHA, commands, exit codes, pass/fail/unverified and SHA256.
  - Wire-attempt and logical-turn outcomes are reported separately.
  - Unverified checks never become pass; failures keep the node open.
  - No real credential or paid provider request is required; all evidence is driven_by=agent.
docs:
  required: true
  files:
    - artifacts/network-protocol-reliability/net-g/report.md
---

# Non-goals

This task does not own network pooling or P50 latency; those remain under TF-0413/TF-0414.
