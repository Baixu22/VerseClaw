---
id: capability-registry-v3-boundary
title: Capability Registry V3 Boundary
type: ai-coding-rule
appliesTo:
  - capability-registry-v3
  - capability-registry-v3-foundation
  - capability-registry-v3-skill-resolver
  - capability-registry-v3-trusted-catalog
  - capability-registry-v3-unified-resolver
  - capability-registry-v3-dcs-result-pointer
  - capability-registry-v3-code-mode
  - capability-registry-v3-provider-native
  - capability-registry-v3-controlled-rollout
---

Capability Registry V3 unifies discoverable metadata, not execution authority.

Hard rules:

- A `CapabilityDescriptor` must not contain an executor reference, function,
  closure, credential, raw tool result, or full tool schema payload.
- Foundation adapters may read explicit metadata supplied by their caller. They
  must not instantiate tools, load Skill bodies, read context stores, or create
  an execution path.
- The shadow catalog is an in-memory, caller-owned snapshot. It must not write
  SQLite, files, prompt state, transcripts, BlockStore, archive storage, or a
  second capability database.
- No V3-00/V3-01 code may modify Tool Search, Code Mode, DCS handlers,
  `tool_registry`, `context_read`, MCP materialization, Host API, Electron
  Main, Renderer, tool registration, approval, retry, or provider dispatch.
- The foundation package introduces no feature flag because no active behavior
  exists to gate. Its rollback is removal of the unused metadata-only caller.
- Canonical descriptor serialization must be deterministic and reject values
  that cannot be represented as the descriptor's declared JSON-safe fields.
- Duplicate capability ids, invalid category/namespace values, and conflicting
  owner metadata must produce explicit diagnostics; conflict resolution must
  not silently choose an owner.
- `dependsOn` expresses workflow relationships only. It cannot grant tool
  permissions or execution authority.
- Fixture corpora and baselines are static, redacted, and reproducible. They
  may estimate text tokens for comparison, but must not claim provider-measured
  usage, TTFT, production recall, or rollout readiness.
- V3-02 Skill resolution may consume a caller-owned shadow catalog only. It
  must stay default-disabled, in-memory, deterministic, and disconnected from
  the Skill loader and prompt formatter. Its L0 projection must retain a
  searchable category name and trigger keywords for every emitted bucket; it
  must not meet a budget by truncating arbitrary text or hiding every signal.
- V3-03 trusted registration accepts only validated Tool descriptors with a
  schema hash and a runtime-owned executor function during cold start or
  controlled reload. Descriptor snapshots and lease handles must never expose
  the executor. A lease is session-bound, opaque, bounded, revocable, and must
  fail closed on any epoch, registration, revision, manifest, schema, expiry,
  session, or permission mismatch.
- V3-04 must delegate Tool search, full-schema description, and execution to
  the existing Tool Search runtime. It may not invoke a catalog Tool directly,
  bypass before-tool hooks/approval/schema validation, or silently execute when
  its explicit opt-in is off. Tool schema hashes are rechecked when L3 is loaded.
- V3-05 DCS projection is navigation metadata only. It may not create or write a
  ContextBlock, construct BlockStore, replace `tool_registry`, inject prompt
  text, expose full Tool schemas at the root, or acquire execution authority.
- V3-05 Result Pointers must use the existing checksum-backed ArchiveHandle
  owner. Pointer metadata contains no raw result; session/task/permission/TTL
  checks happen before archive verification; checksum, missing, and cleanup
  outcomes fail closed; slice/search/read are scan/output/match bounded.
- V3-06 may reuse only the existing Tool Search Code Mode sandbox and bridge
  protocol. Its `search` and `describe` operations must use V3 progressive
  disclosure; each `call` must issue a session-bound lease, invoke through the
  V3 resolver into Tool Search, forward abort/progress, revoke its lease, and
  return a Result Pointer rather than a raw target result. A bridge request id
  is idempotent within one run and may not replay a target side effect.
- The V3-06 runner output boundary is closed. The bridge registers the
  canonical JSON identity of every container it hands out (search navigation
  metadata, the describe L3 projection, call pointer metadata, and every
  nested container inside them). A runner final value is accepted only when
  it is a non-empty JSON-safe composition whose containers are those exact
  registered identities or new envelopes whose children are all accounted
  and which contain at least one registered container; bare primitives may
  never appear outside a registered container, so known strings cannot be
  re-keyed into fabricated objects. Primitives, plain unprovenanced objects,
  raw target results, raw/rawResult/rawTargetResult/content/details/
  credentials shapes, and injected runners that never call the bridge fail
  closed as a controlled code-mode-failed result that reflects no raw input,
  target output, or underlying exception text. Whole-value canonical identity
  is the primary mechanism; field-name blacklists and leaf fingerprints are
  not sufficient on their own.
- V3-07 must not implement or call provider transport directly. It accepts a
  provider-owner contract only after exact provider/model/workflow allowlist
  and capability-probe checks. Retry and proxy fallback are allowed only for
  failures explicitly proven pre-start; a started, completed, or ambiguous
  native request must fail closed and cannot replay a target side effect.
- V3-08 remains default-disabled and caller-owned. Shadow decisions cannot
  authorize execution; opt-in/canary activation requires an exact, wildcard-free
  provider/model/workflow allowlist match and kill-switch=false. Cohorts must be
  deterministic, receipts bounded and raw-result-free, metric attributes
  low-cardinality, and reports unable to change default-on/live/product locks.

Validation mapping:

- Contract tests cover canonical hashes, serialization exclusion, adapter
  direction, deterministic ordering, conflict diagnostics, and no-op lifecycle.
- Path ownership validation ensures the foundation package stays within the
  new V3 module, V3 harness specs, fixtures, acceptance record, and plan.
- Follow-up execution packages must add explicit flag-off parity, rollback,
  security, and topology tests before connecting this metadata to runtime paths.
