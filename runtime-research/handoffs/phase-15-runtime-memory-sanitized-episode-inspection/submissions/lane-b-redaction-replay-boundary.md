# Phase 15 Lane B: Redaction And Replay Boundary

## Scope Rechecked

- Source: Runtime Memory sanitizer and persistence/load paths.
- Tests: focused Runtime Memory runtime integration and TaskLoop replay tests.
- Prior phase evidence: Phase 14 replay proof already rejects raw TaskLoop markers.

## Evidence

| Claim | Evidence | Result |
|---|---|---|
| Raw markers do not enter inspection JSON | Focused test attempts a raw transcript episode that is rejected, then asserts inspection JSON excludes task text, self-check, subagent/template, stdout/stderr, env, secrets, trace context, raw row, and `record_json` markers. | accepted |
| Inspection stays episode-only | Facts and candidates are persisted in the same store, but the inspection JSON is built only from `listEpisodes()` and episode-only stats. | accepted |
| Replay remains sanitized | Existing Phase 14 TaskLoop test asserts loaded episode redaction status is `sanitized` and raw TaskLoop markers are absent. | accepted |

## Commands

```text
cmd /d /s /c ""C:\Users\27933\.cherrystudio\bin\rtk.exe" "C:\Program Files\nodejs\node.exe" node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-runtime-integration.test.ts"
```

Result:

```text
pass in focused 9-file validation pack, 113 tests
```

## Rejected Claims

- No raw DB rows, prompt, transcript, tool output, env, secret, or raw trace context in inspection output.
- No facts-as-runtime-authority claim.

## Gaps

- None.

Status: accepted
