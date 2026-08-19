# Knowledge System Unification Worktree

- Branch: `codex/knowledge-system-unification-plan`
- Base commit: `734ec877e75682861103660fbdea2bd55253ece0`
- Purpose: unified knowledge lifecycle architecture and executable development plan
- Runtime behavior: product locks remain `default-off`, `liveReady=false`, `productApproved=false`, `defaultOn=false`.

Primary document:
`docs/dev/knowledge-system-unification-development-plan.zh-CN.md`

Implemented and accepted packages (2026-08-17):
- KS-00 baseline, authority, schema, status freeze
- KS-01 ReviewBundle and governance integrity
- KS-02 experience write truth and session cascade
- KS-03 GovernanceStore and owner adapters
- KS-04 Chat/DCS single consumption path
  - Spec: `harness/specs/tasks/knowledge-system-ks04-chat-dcs-single-path.md`
  - Evidence: `docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md`

Implemented and accepted packages (2026-08-18):
- KS-05 Experience closed loop
  - Spec: `harness/specs/tasks/knowledge-system-ks05-experience-closed-loop.md`
  - Evidence: `docs/dev/knowledge-system-unification/evidence/KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md`

Implemented and package-gated (2026-08-18, 方案 B runtime authority close; Task Forest proposal `TFP-c250f2cbab` applied):
- KS-06 Complete governance lifecycle
  - Spec: `harness/specs/tasks/knowledge-system-ks06-governance-lifecycle.md`
  - Evidence: `docs/dev/knowledge-system-unification/evidence/KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md`
  - Runtime lifecycle, idempotency, compensation, and unsupported-UI static gate are package-gated.
  - Honest residual: memory-wiki Main RPC write entry and lifecycle UI/per-operation Electron E2E are mandatory KS-08 carry-over.
  - Task Forest close-out executed only through `proposal-save + proposal-apply + validate + export` (`TFP-c250f2cbab` applied; validate/export PASS).

Implemented and package-gated (2026-08-18, Task Forest proposal `TFP-knowledge-system-ks07-closeout-20260818` applied):
- KS-07 Semantic retrieval and Source Set
  - Spec: `harness/specs/tasks/knowledge-system-ks07-semantic-retrieval-source-set.md`
  - Evidence: `docs/dev/knowledge-system-unification/evidence/KS-07-SEMANTIC-RETRIEVAL-SOURCE-SET-ACCEPTANCE.md`
  - SourceSet/v1 exact/lexical/semantic hybrid retrieval, sensitivity/ACL/status filtering, conflict disclosure, freshness rerank, citation-resolvable claims, unknown/next-action output, Runtime Memory shadow-only comparison, DCS candidate packing.
  - Committed corpus quality report: `docs/dev/knowledge-system-unification/quality/KS-07-SOURCE-SET-QUALITY.json` (Recall@5=1, Precision@5=1, citation validity=1, stale inclusion=0, conflict disclosure=1; human usefulness not-evaluated).
  - Task Forest close-out executed through CLI (`TFP-knowledge-system-ks07-closeout-20260818` applied; validate/export PASS).

Evidence:
`docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-07-SEMANTIC-RETRIEVAL-SOURCE-SET-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-08-UI-OBSERVABILITY-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-09-CANARY-GRADUATION-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-FULL-INTEGRATION-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-REAL-PROVIDER-E2E.md`

Implemented and package-gated (2026-08-18, Task Forest proposal `TFP-knowledge-system-ks08-closeout-20260818` applied):
- KS-08 Knowledge UI and observability
  - Spec: `harness/specs/tasks/knowledge-system-ks08-ui-observability.md`
  - Evidence: `docs/dev/knowledge-system-unification/evidence/KS-08-UI-OBSERVABILITY-ACCEPTANCE.md`
  - memory-wiki lifecycle owner mutations (update/merge/archive/revoke/delete/restore) with revision CAS, Main RPC wiring, receipt history, Knowledge lifecycle UI, degraded-write truth, Electron E2E 6/6.
  - KS-06 carry-over items are closed: memory-wiki `wiki.*` lifecycle Main RPC + Knowledge lifecycle UI with per-operation Electron E2E.
  - Task Forest close-out executed through CLI (`TFP-knowledge-system-ks08-closeout-20260818` applied; validate/export PASS).

Implemented and package-gated (2026-08-18, Task Forest proposal `TFP-knowledge-system-ks09-closeout-20260818` applied):
- KS-09 Canary, optimization and graduation
  - Spec: `harness/specs/tasks/knowledge-system-ks09-canary-optimization-graduation.md`
  - Evidence: `docs/dev/knowledge-system-unification/evidence/KS-09-CANARY-GRADUATION-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-FULL-INTEGRATION-ACCEPTANCE.md`
`docs/dev/knowledge-system-unification/evidence/KS-REAL-PROVIDER-E2E.md`
  - Six reproducible per-surface reports under `docs/dev/knowledge-system-unification/surface-reports/`; stages shadow/opt-in only, E4 all not-evaluated, E5 all blocked, zero default-on/GA/productApproved claims.
  - Task Forest close-out executed through CLI (`TFP-knowledge-system-ks09-closeout-20260818` applied; validate/export PASS); TF-0070 milestone done(100%).
  - Default-on/GA remains an independent product-approval gate; product locks stay false.
