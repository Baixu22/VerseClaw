---
id: rsi-protocol-contrast-boundary
title: RSI protocol contrasts share a budget and matched case identity
type: ai-coding-rule
severity: error
appliesTo:
  - scripts/rsi-protocol-contrast.*
  - scripts/rsi-protocol-contrast-replay.*
  - scripts/rsi-coding-collector.*
  - scripts/lib/rsi-benefit-eval.*
---

Protocol contrasts use a new frozen plan and one campaign ledger. Every version
has a distinct request identity and scratch path. Experience injection is off;
task, scope, baseline, reference oracle, safety, anchors and split stay matched.
The budget includes preflight and every continuation. Budget refusals consume
zero calls; unknown usage follows an actual reserved dispatch or interruption.

An off-only validation entry explicitly binds the study budget at slot start.
The ordinary benefit validator retains its full scheduled-prefix requirement.
Replay derives budgets from raw ledger entries, validates all retained responses
and effects, and calculates v3 minus v2 and v4 minus v3 on complete case clusters.
Historical campaign receipts and resource authorizations remain immutable.
