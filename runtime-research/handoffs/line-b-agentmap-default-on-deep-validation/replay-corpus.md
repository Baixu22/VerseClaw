# Replay Corpus

Corpus size: 154 cases.

Composition:

- 81 flag-combination cases: all omitted/off/on combinations for `promptAssemblyExperiment`, `promptCandidateRuntimeShadow`, `promptCandidateControlledCutoverPilot`, and `promptCandidateTaskLoopExplicitInvocationPilot`.
- 36 core matrix cases: explicitInvocation true/false, AgentMapResult valid/invalid/missing, budget normal/near-limit/exhausted, prompt present/absent.
- 27 pilot-gate cases: runtime shadow enabled/disabled, controlled cutover pilot enabled/disabled, and TaskLoop explicit invocation pilot enabled/disabled.
- 10 additional named cases for provider ordering, checkpoint/lifecycle, long context, multi-file, failed task, blocked task, malformed candidate text, candidate sentinel, production-entry sentinel, and default-on sentinel.

The focused unit test constructs this corpus in `tests/unit/runtime-agent-map-default-on-deep-validation.test.ts`.
