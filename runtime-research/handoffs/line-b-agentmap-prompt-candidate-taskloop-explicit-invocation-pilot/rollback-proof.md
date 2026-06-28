# Rollback Proof

Rollback is flag and call-site based:

- Disable `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot` to restore legacy TaskLoop reviewer prompt byte parity.
- Disable `runtime.agentMap.promptCandidateControlledCutoverPilot`, `runtime.agentMap.promptCandidateRuntimeShadow`, or `runtime.agentMap.promptAssemblyExperiment` to restore legacy TaskLoop reviewer prompt byte parity.
- Omit explicit TaskLoop pilot invocation to keep `formatTaskLoopContextPackForReviewer(...)` unchanged.
- Omit explicit `AgentMapResult` input to keep the TaskLoop pilot surface in legacy mode.
- Keep `runtime.agentMap.provider` omitted or false to avoid provider registration.

No candidate or replay output is persisted by this phase, so rollback requires no disk cleanup.

Rollback proof must include tests showing:

- Flags-off default reviewer prompt is byte-identical.
- All gates enabled but no explicit invocation leaves default reviewer prompt byte-identical.
- Closing any gate after an inserted pilot returns legacy prompt bytes.
- Budget exhaustion and prompt-present exclusion fail closed or exclude without partial misleading prompt insertion.
