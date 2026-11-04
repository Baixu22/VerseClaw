---
id: rc03-seal-coverage
title: RC-03 producer admission and seal coverage
type: ai-coding-rule
severity: error
---

RC-03 remains default-off. Its kill switch and default values must not change.
Off paths report `sealCoverage=disabled`, emit no RC-03 plan/receipt, and retain
the same request bytes. Final snapshot immutability is independent of RC-03;
its existing `sealed` property is not a claim that RC-03 is enabled.

Derive the producer/mutation/phase matrix from the existing SealRegistry.
Freeze registration facts. Every applied lineage source, explicit producer
and bypass-boundary producer must pass pre-seal admission. Unknown sources
must not disappear from the plan, including when explicit producer ids are
supplied. Dropped/empty candidates are not applied mutations.

Only registered non-semantic transport transforms may run post-seal. At the
embedded stream boundary, compare the real system prompt before and after
the registered cache-boundary removal with the sealed digest. A changed
semantic prompt rejects before the provider function runs. Context extension
fail-open handling must propagate a structured seal denial.

Tests must cover every matrix row, default-off and kill behavior, unknown
system-prompt producers, semantic use in the post-seal phase, duplicate ids,
and a legal continuation. Label measurements agent-driven. Registry/API
coverage does not claim live provider or complete adapter wire attestation;
the existing request-envelope/transport owners retain that responsibility.
