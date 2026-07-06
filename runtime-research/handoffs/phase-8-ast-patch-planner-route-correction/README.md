# Phase 8 AST Patch Planner Route Correction

Status: accepted_route_correction_foundation

## Decision

AST is a structured code-edit planning layer, not a runtime intelligence layer and not a general runtime optimization layer.

The corrected route is:

```text
AgentMap/Symbol scope
  -> AST candidate plan
  -> Evidence Verifier
  -> explicit apply gate
```

The existing TypeScript/TSX readonly helper remains useful as a prototype/fallback safety skeleton. The current TypeScript/TSX readonly helper remains useful as a prototype/fallback safety skeleton, but it is not the corrected production engine, and future work should not expand it into TaskLoop, Gateway, provider transport, prompt/model-message, persistence, service, or default-on behavior.

## Short-Term Implementation Goal

The next AST implementation slice should build the foundation for structured patch planning:

- define an `EditPlan IR` that can represent ordered edits, ranges, source hashes, preview diff hashes, verifier requirements, and apply eligibility;
- add a real ast-grep adapter for TypeScript/TSX pattern/fix scan and preview candidate generation;
- keep the adapter explicit-call, readonly, caller-owned, and default-off;
- feed it with AgentMap/Symbol-selected files or ranges;
- return diagnostics/planning evidence only, never task-completion evidence.

## Current Prototype Boundary

The current runtime-core helper is accepted only as:

- explicit in-memory TypeScript/TSX scan;
- readonly match evidence;
- bounded diagnostics;
- optional preview diff text/hash;
- checkpoint/resume drift diagnostics;
- no patch apply;
- no workspace edit;
- no symbol mutation;
- no TaskLoop/Gateway/Main/renderer route;
- no provider transport;
- no prompt/model-message insertion;
- no default-on AST behavior.

## Rejected Direction

The route correction rejects:

- AST as runtime optimization;
- AST as runtime intelligence;
- automatic TaskLoop invocation;
- default-on AST behavior;
- preview diff as completion evidence;
- agent-generated rules directly applying patches;
- string patching described as AST patching;
- provider/tool/Gateway/Main/renderer/host-api/api-client integration.

## Next Slice

The next slice should be a fresh implementation spec for `EditPlan IR + ast-grep adapter readonly candidate generation`. It must preserve the route-correction boundary and prove value with real code-edit tasks such as React prop rename, API call migration, import rewrite, IPC route rename, and deprecated option removal.

Use `runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/next-phase-prompt.md` as the persistent new-thread prompt for that work.
