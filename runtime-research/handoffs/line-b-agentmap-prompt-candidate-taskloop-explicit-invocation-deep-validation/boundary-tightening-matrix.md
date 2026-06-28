# Boundary Tightening Matrix

| Boundary | Result | Evidence |
|---|---|---|
| Flags omitted | pass | `runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts` partial gate replay cases and `task-loop-controller.test.ts` default reviewer parity keep legacy bytes. |
| Partial gates | pass | One, two, three, and explicit false fourth gate cases return legacy reviewer prompt bytes with `gate_disabled` diagnostics. |
| Explicit invocation omitted | pass | Explicit invocation false returns legacy bytes with `invocation_not_requested` diagnostics. |
| Missing/invalid AgentMapResult | pass | Missing and invalid result cases return legacy bytes with `invalid_agent_map_result`. |
| Budget exhausted | pass | Token budget 0 and oversized sentinel candidate return legacy bytes with `candidate_budget_exhausted`; no partial candidate is inserted. |
| Prompt-present file | pass | POSIX and Windows-style prompt-present paths exclude `src/pages/Chat/Composer.tsx` and emit `prompt_present_file_excluded`. |
| Empty candidate | pass | Empty candidate result returns legacy bytes with `candidate_empty`. |
| Valid explicit pilot | pass | Valid result plus all gates plus explicit invocation inserts only into `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |
| Sentinel leakage | pass | `AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK` appears only in tests; TaskLoop reviewer, lifecycle, checkpoint, and runtime-shadow payload assertions exclude it. |
| Provider ordering | pass | Existing context provider registry tests pass and no provider registration/order files were changed by this phase. |
| Persistence | pass | No candidate/replay persistence code added; scans show only forbidden-boundary prose and pre-existing runtime-memory test lines. |
| Renderer/Gateway | pass | Renderer direct IPC/Gateway scan returns no matches. |
| Runtime authority | pass | Helper metadata/tests preserve no runtime/tool/Gateway/provider/model authority; no production runtime authority code changed. |
| Rollback | pass | Closing any pilot gate returns byte-identical legacy reviewer prompt output. |
