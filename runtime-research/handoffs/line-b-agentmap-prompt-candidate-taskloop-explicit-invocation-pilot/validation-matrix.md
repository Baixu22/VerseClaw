# Validation Matrix

| Requirement | Evidence |
|---|---|
| New task spec validates | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md` |
| Phase 8 remains accepted | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md` has `Status: accepted` |
| Phase 9 remains accepted | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md` has `Status: accepted` |
| Phase 10 remains accepted | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md` has `Status: accepted` |
| Phase 11 remains accepted | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-controlled-cutover-pilot/synthesis.md` has `Status: accepted` |
| New TaskLoop gate default-off | Config schema/type/help/label tests prove omitted flags do not synthesize true |
| Flags-off reviewer prompt parity | TaskLoop tests compare `formatTaskLoopContextPackForReviewer(...)` bytes before and after pilot availability |
| No explicit invocation reviewer prompt parity | TaskLoop tests call default formatter with all flags enabled and no explicit pilot invocation |
| Any gate closed fails closed | Runtime helper tests assert legacy prompt bytes and `gate_disabled` diagnostics |
| Invalid/missing AgentMapResult fails closed | Runtime helper tests assert legacy prompt bytes and invalid-result diagnostics |
| Explicit invocation inserts candidate only in named surface | Runtime helper and TaskLoop tests assert `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` |
| Prompt-present files excluded | Runtime helper tests assert exclusion diagnostics and no duplicate file section |
| Budget exhaustion fails closed | Runtime helper tests assert legacy bytes and no silent truncation |
| Model/Gateway/provider/default prompt boundary | Boundary scans and touched-file review |
| Provider ordering unchanged | Existing provider registry/context provider focused tests |
| No persistence | Touched-file persistence scan |
| No renderer direct IPC/direct Gateway call | Renderer boundary scan |
| Type safety | `pnpm --config.verify-deps-before-run=false run typecheck` |
| Comms decision | Run comms replay/compare if communication paths are touched; otherwise record skip reason |
