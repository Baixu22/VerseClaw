# Phase 5 Handoff: Evidence Verifier

Phase 5 starts after Phase 4 accepted event-log/checkpoint/resume work as shadow-only. The goal is to define and pilot a canonical Evidence Verifier that can reason over file, test, tool, trace, and human evidence without changing legacy runtime behavior by default.

## Phase Goal

Build the smallest feature-flagged verifier foundation for:

- canonical evidence kinds and verifier decision taxonomy;
- verifier inputs that include task objective/id, obligations, evidence refs, tool results, and event replay summaries;
- deterministic findings with severity, category, code, and evidence refs;
- a strict `failed` vs `blocked` distinction where `blocked` requires an external dependency;
- shadow/pilot reports that preserve legacy TaskLoop, tool, approval, retry, error mapping, and return payload behavior when flags are off.

## Non-Negotiable Constraints

1. Do **not** enable a default-on verifier completion gate.
2. Do **not** add renderer direct `window.electron.ipcRenderer.invoke(...)` calls.
3. Do **not** add renderer direct Gateway HTTP/WebSocket calls to `127.0.0.1:18789` or `localhost:18789`.
4. Do **not** start a second runtime service, daemon, listener, HTTP server, WebSocket server, Temporal service, or Gateway instance.
5. Do **not** execute external lint, typecheck, tests, shell commands, or diagnostics from verifier runtime behavior.
6. Do **not** use an LLM judge for verifier decisions.
7. Do **not** persist raw prompts, full event payloads, full checkpoints, full tool args, or full tool output.
8. Keep existing TaskLoop, `tools.invoke`, approval waiting, retry, error mapping, and return payload behavior unchanged with flags off.
9. Treat ordinary test/tool failures as `failed`; reserve `blocked` for missing external input/state.
10. Verification shadow sampling remains observe-only and is not a Phase 5 completion gate.

## Required Reading

Every implementation window must read:

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`, Phase 5
- `runtime-research/migration-execution-plan.md`, Stage 6
- `runtime-research/agent-runtime-core-spec.md`, section 6
- `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/synthesis.md`
- `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-e-evidence-verifier-shadow.md`
- `harness/specs/tasks/phase-5-evidence-verifier.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md
```

## Output Rules

Each lane writes exactly one submission:

```text
runtime-research/handoffs/phase-5-evidence-verifier/submissions/<lane-id>.md
```

Lane owners may edit only their declared implementation/test paths and their own submission file. Cross-lane conflicts are recorded in `Design Conflicts` / `Handoff Notes`; the synthesis owner reconciles them.

## Expected Lanes

- `lane-a-contracts-and-harness`
- `lane-b-evidence-collector-shadow`
- `lane-c-runtime-adapter-shadow`
- `lane-d-completion-gate-pilot-plan`
- `lane-e-validation-docs-synthesis`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not treat under-evidenced implementation claims as accepted facts.
