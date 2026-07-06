# Next Phase Prompt

Use this prompt when starting a fresh thread for the corrected AST line.

## Copy/Paste Prompt

```text
We are continuing the ClawX AST route-correction work.

Persistent objective:
Implement the next AST phase as EditPlan IR plus a real ast-grep readonly candidate-generation adapter. AST must remain a structured code-edit planning layer, not a runtime intelligence layer, not a general runtime optimization layer, and not task-completion authority.

Read first:
- AGENTS.md
- runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/README.md
- runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/short-term-foundation.md
- runtime-research/ast-grep/rule-structure.md
- runtime-research/ast-grep/patch-flow.md
- runtime-research/ast-grep/useful-tests.md
- runtime-research/ast-grep/clawx-mapping.md
- runtime-research/agent-runtime-index.md

Start by creating a fresh task spec under harness/specs/tasks/, tentatively named:
harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md

Run:
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md

Goal:
Build the foundation for the corrected AST route:
AgentMap/Symbol scope -> AST candidate plan -> Evidence Verifier -> explicit apply gate.

Implement only readonly candidate generation. Do not implement apply.

Required capabilities:
1. Define EditPlan IR types in runtime-core.
2. Represent plan id, engine id, source scope, target files, source hashes, match ranges, AST kinds, ordered edits, conflict diagnostics, preview diff hash/text metadata, verifier requirements, and applyEligibility.
3. Add an ast-grep adapter for TypeScript/TSX readonly pattern/fix candidate generation.
4. Keep adapter inputs caller-owned and explicit. Prefer in-memory targets for the first slice unless the spec explicitly allows bounded file reads.
5. Return EditPlan IR plus diagnostics; do not write files.
6. Keep the current TypeScript/TSX text-matcher helper as prototype/fallback safety skeleton only. Do not expand it as the production engine.
7. Add fixtures for React prop rename, API call migration, import rewrite, Electron IPC route rename, deprecated option removal, invalid rule, overbroad rule, overlap conflict, and drift/fingerprint mismatch.
8. Add tests that prove candidate generation is deterministic, bounded, fail-closed, and non-authoritative.

Hard constraints:
- No patch apply.
- No file write.
- No workspace edit.
- No symbol mutation.
- No rename/replaceBody/insertBefore/insertAfter/safeDelete authority.
- No TaskLoop/Gateway/Main/renderer/host-api/api-client route.
- No provider transport, provider ordering, prompt/model-message insertion, service/listener/daemon, persistence, external database, or default-on behavior.
- No preview diff, match count, candidate text, or EditPlan output may be treated as task-completion evidence.
- No renderer direct IPC or direct Gateway HTTP/WebSocket.

Acceptance:
- Harness context and validate pass for the fresh task spec.
- Focused unit tests pass for EditPlan IR, ast-grep adapter, route-correction sentinels, and existing AST readonly scan.
- Boundary scans find no apply/write/workspaceEdit/symbol mutation/runtime authority surfaces in touched production files.
- The runtime index records the next phase without widening authority.
- README docs are reviewed; no product docs update is needed unless user-facing behavior changes.
- Runtime behavior remains unchanged when the new adapter is not explicitly called.

If ast-grep binary/library integration is blocked, stop at a documented adapter interface plus deterministic fixtures and record the blocker. Do not fall back to expanding the current text matcher as the corrected production path.
```

## Non-Negotiable Positioning

AST belongs to patch engineering:

```text
AgentMap/Symbol scope
  -> AST candidate plan
  -> Evidence Verifier
  -> explicit apply gate
```

It must not become:

- runtime intelligence;
- runtime optimization;
- runtime authority;
- default-on behavior;
- task completion evidence;
- hidden file mutation.

## Expected First PR Shape

- New task spec for EditPlan IR and ast-grep readonly candidate generation.
- Runtime-core `EditPlan` contracts.
- ast-grep adapter interface and readonly implementation or documented blocked adapter interface.
- Focused fixtures and unit tests.
- Updated route-correction/index docs.
- No UI, Gateway, renderer, provider transport, persistence, or apply path.
