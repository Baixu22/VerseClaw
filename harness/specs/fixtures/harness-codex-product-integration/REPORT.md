# TF-0567 Codex Product Integration Evidence

> Agent-driven evidence. This proves the Session effective-state projection and its focused validation. It does not prove a live authenticated Codex model turn, packaged Electron UI execution, ACP availability, or product approval.

## Verdict

| Claim | Observed state |
|---|---|
| Session policy exposes a harness axis | implemented |
| Configured vs observed harness is separated | pass (focused tests) |
| Missing/stale/mismatch never promote configured harness | pass (focused tests) |
| Session activity panel renders harness state | pass (component test) |
| Typecheck / i18n / contract / harness validation | pass (see receipt) |
| Electron E2E | pass (policy surface + 1 success / 2 failure chat turns) |
| Authenticated Codex model turn | not-run (host/renderer replay, not live provider) |
| Default runtime selector / scheduler changed | false |
| Product approval / release approval | not-claimed |

## Implementation

- `shared/types/session-effective-policy.ts` adds `SessionPolicyHarness` and a `harness` axis.
- `openclaw_runtime/src/gateway/session-effective-policy.ts` derives configured harness from the resolved runtime and effective harness only from the current capability observation.
- `src/pages/Chat/SessionActivityPanel.tsx` renders `configured -> effective` plus the existing generation reason.
- Four locales add the `sessionActivity.policy.harness` label via `i18next`.

## Boundaries

- No Settings runtime selector was added; the existing provider/model selection remains the selection surface.
- No ACP adapter was activated and no implicit fallback was added.
- No scheduler, Task Ledger, approval, trace or memory authority changed.
- No default value, product lock, release state or public state changed.
- No credentials or private prompts are retained.
- All evidence is agent-driven; no real-human evidence is claimed.

## Negative case

- Explicit `agentHarnessRuntimeOverride=codex` with no registered Codex harness throws `MissingAgentHarnessError`; it does not silently fall back to OpenClaw.
## Identity boundary

- SessionEffectivePolicy.scope keeps sessionKey, sessionId, runId and agentId together for native and harness-backed runs.
- The harness axis is projected from the same current-generation capability observation as backend/model/grants; it is not a separate session or turn identity.
- Codex thread-level identity and visible transcript sharing remain not-run until a real Electron Chat turn is executed. This report does not claim that a thread was reused or that a model turn completed.
## Electron evidence

- `pnpm exec playwright test tests/e2e/long-session-policy-surface.spec.ts --workers=1 --reporter=line`: 1 passed (60.0s).
- `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep "preserves foreground exec output|anchors the live thinking matrix" --workers=1 --reporter=line`: 2 passed / 1 failed on an ambiguous selector; after narrowing the selector the completed-turn case passed independently (1 passed, 16.4s). The final host/renderer evidence therefore covers one success and two failed/aborted turns.
- Windows E2E launcher fixes: install Electron 40.8.4 from the existing cache, always pass `--no-sandbox` for isolated userData on Windows, and set `VERSE_CLAW_USER_DATA_DIR` plus `CLAWX_E2E_RUN_ROOT` to a writable test-results directory.

## Reproduction notes

- E2E run root must be writable on C: for Electron home/userData; `D:\tmp` produced `EPERM` on `.openclaw` and userData logs.
- Windows E2E launcher now always passes `--no-sandbox`; the Electron 40.8.4 binary was restored from the local cache with `node node_modules/electron/install.js`.
- The chat completed-turn test initially hit an ambiguous `getByText` selector; scoping it to `chat-user-message-bubble` made the final rerun pass.
