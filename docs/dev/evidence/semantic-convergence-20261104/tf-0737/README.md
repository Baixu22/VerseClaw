# TF-0737 retained evidence

- driven_by: agent; actor: codex/prompt-authority.
- Clean tested source candidate: 5866f51f8e09a6c3ad6aced78c78040c58f2f230. All acceptance gates recorded stable before/after source hashes.
- 163/163 tests passed (root 100, runtime 50, retry 13); permission tests 48. No skips.
- Explicit enforce rejects undeclared replacements and builtin privilege escalation; matching declarations continue.
- PROMPT-1 field-map coverage 0/5 -> 5/5. Static source snapshots identify their real ref, separately from the measurement driver.
- Full typecheck is not green: two pre-existing RSI errors. Node/web and scoped test dependency closure passed.

commands.json contains commands, exits, timings, environment, the raw authority decision/continuation trace and its reproducible driver source. scope-typecheck.json keeps the scoped compiler input. source-manifest.json binds current code and the unchanged unrelated RSI sources. SHA256SUMS covers every retained file except itself.

To replay the function-level trace, extract behavioralTraceDriver.source from commands.json into D:/tmp/tf0737-behavioral-trace-driver.mjs, then run:

`node --experimental-transform-types D:/tmp/tf0737-behavioral-trace-driver.mjs <worktree-root> D:/tmp/tf0737-behavioral-trace.json`

Warn remains the default; no default-on, GA, live-provider, real-human or full RC-03 claims are made. Historical source-chat files are preserved privately and superseded; their reported counts are not accepted as evidence.
