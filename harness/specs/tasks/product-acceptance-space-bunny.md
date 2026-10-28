---
lifecycleStatus: active
id: product-acceptance-space-bunny
title: Space-bunny Responses provider and product round trip
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Verify the authorized local space-bunny Responses endpoint through direct protocol probes and the real ClawX Renderer/Main/Gateway path, including tool effects, session isolation, cancellation and bounded failure recovery.
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
  - comms-regression
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - .gitignore
  - harness/specs/tasks/product-acceptance-space-bunny.md
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/fixtures/product-acceptance-closeout/b1-space-bunny/**
  - tests/e2e/product-acceptance-space-bunny.spec.ts
  - tests/e2e/fixtures/space-bunny-responses.ts
  - playwright.config.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/openclaw-auth.test.ts
  - electron/services/providers/provider-validation.ts
  - electron/services/providers/provider-runtime-sync.ts
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/openai-transport-stream.test.ts
  - openclaw_runtime/src/agents/openai-transport-stream-responses-input.test.ts
  - scripts/repository-artifacts.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A custom provider explicitly configured as openai-responses reaches the Responses endpoint and produces a visible final reply after an actual tool result.
  - The next turn can use the existing tool result while another session cannot see that result.
  - Cancellation and provider failure surface a bounded terminal outcome and a later turn succeeds without a duplicate effect.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec playwright test tests/e2e/product-acceptance-space-bunny.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/provider-validation.test.ts tests/unit/provider-runtime-sync.test.ts tests/unit/openclaw-auth.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/openai-transport-stream.test.ts src/agents/openai-transport-stream-responses-input.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm harness validate --spec harness/specs/tasks/product-acceptance-space-bunny.md
  - pnpm harness run --spec harness/specs/tasks/product-acceptance-space-bunny.md --dry-run
  - pnpm docs:policy:validate
  - pnpm repo:artifacts:check
  - pnpm repo:evidence:check
  - git diff --check
acceptance:
  - Direct non-streaming text, completed SSE and ga_echo function_call/function_call_output probes succeed with the requested and returned model, response/call/request IDs, observed timings and provider usage recorded.
  - Three independent clean-profile product smokes configure a custom Responses provider through the Renderer host bridge, send through the Chat UI and prove a real tool effect, visible final reply, same-session readback and other-session isolation.
  - An isolated proxy injects cancellation, 401, 404, 429, 500, HTTP 504, a stalled SSE client timeout and malformed or dropped SSE without changing the upstream service; failures never produce a false completed response, retries remain bounded and the next turn recovers.
  - The production tool effect occurs exactly once, including continuation and recovery; shutdown leaves no owned proxy request, listener or Electron/Gateway process.
  - Credentials enter child processes only through environment, never appear in retained requests, logs, screenshots or artifacts; any actual exposure is recorded honestly as an incident rather than a zero-exposure claim.
  - A clean candidate and complete retained b1 manifest bind source/build inputs, commands, exit codes, parsed counts, request/tool/effect lineage, actor, independent verifier, SHA256 and explicit limitations.
docs:
  required: true
  files:
    - harness/specs/tasks/product-acceptance-space-bunny.md
---

# Space-bunny Responses acceptance

This is the TF-0580 contract under `product-acceptance-closeout`. Use the owner-authorized
local resource from the private Task Forest root. The test process receives
`CLAWX_SPACE_BUNNY_ENDPOINT`, `CLAWX_SPACE_BUNNY_MODEL` and
`CLAWX_SPACE_BUNNY_API_KEY` through environment. Do not serialize the resource JSON or
request headers. Missing resources fail the required live test rather than skipping it.

The endpoint is `/v1/responses`; a provider adapter that appends `/responses` receives
the `/v1` base. Keep the declared `openai-responses` protocol throughout. A Chat Completions
substitution, unsupported tool output or uncompleted SSE cannot satisfy this contract.
Function output references the original `call_id`. Record the upstream `model` as returned;
an alias is not evidence of an independently identified underlying model.

Probe direct text, stream and a single controlled `ga_echo` before the product smokes.
For the product journey, configure the account through the same Renderer host bridge used
by Settings, use a disposable profile/workspace and invoke the existing real tool through
Chat. Persisted effect readback and the provider's replayed tool result are the oracles;
model self-reports alone are insufficient. Use opaque random fixture markers so that the
readback prompt does not itself supply the answer. The isolated session receives a prompt
that contains neither the tool result nor its marker.

The local proxy forwards normal requests to the authorized endpoint and observes only
allowlisted body fields and SSE events. Injection is explicit and local to the proxy.
Terminal failures and cancellation require an error/aborted runtime receipt, no completed
marker, no new effect and a successful later turn. Fault observations include request counts
and elapsed time, with no product timeout/retry/permission changes made to obtain a pass.
HTTP 504 is recorded separately from a stalled SSE that produces the runtime's observed
request timeout. The stalled stream stays open until the client timeout aborts it; the
proxy's 180-second safety ceiling is longer than the existing product request timeout.
Incomplete function arguments fail before tool dispatch. Output and content/summary
indexes are resolved per provider item, so reasoning cannot consume the visible answer.
Even complete arguments remain non-final until the stream passes its response terminal
check; complete-arguments followed by EOF, failed or incomplete events emit no tool end.

Budget declared before execution: each upstream HTTP request is at most 120 seconds; each
GUI journey is at most 12 minutes and 40 UI actions. Three smokes use distinct clean profiles
and fixtures. The upstream key is never typed into a captured UI or included in Playwright
traces: the proxy accepts an inert test credential and injects the real credential only in
its upstream HTTP request. Use DOM/accessibility and deterministic file or transcript
readback; image capability is unverified.
Select this live suite with `CLAWX_SPACE_BUNNY_ACCEPTANCE=1`; ordinary E2E discovery
excludes it. Selected acceptance still fails on missing resources. Diagnostic development
runs explicitly use `CLAWX_SPACE_BUNNY_PREFLIGHT=1` and emit `preflight-pass`, never
acceptance `pass`, when the source is dirty. Final acceptance requires a clean candidate,
matching runtime build stamp and before/after hashes for the source and all launched
renderer, Electron and runtime build files. Final pass is persisted only after screenshot,
shutdown and binding checks. The proxy uses a per-run inert token, checks HTTP method and
content type, and preserves incoming UTF-8 bytes.

Final runs also require `CLAWX_SPACE_BUNNY_BUILD_PROOF`, a sealed source/build digest
created after successful fresh `build:vite` and `build:runtime` commands on the clean
candidate. The proof includes those command receipts and their candidate binding.
A modified ignored build file must fail this digest check even when the runtime build
stamp still names the correct commit. Assistant text is replayed as the SDK-supported
input message string; the paired function call and output keep their original call ID.

A cleanup negative control runs with the Gateway still stopped. The expected missing-PID
check fails, while a finally block still closes the owned Electron process and proxy;
the failure receipt stays failed and a separate control receipt records the reclamation.

Cancellation includes explicit delayed Main-to-Renderer text, tool and final frames for
the canceled run, before and during recovery. Those synthetic frames remain labeled
agent-driven; they must not appear in the final UI/transcript or create a file effect.

Write raw runs to `D:/tmp/clawx-product-acceptance/<run-id>/b1-space-bunny/`. Use
`TEMP=TMP=D:/tmp`, preserving the ordinary Windows environment. If Electron rejects the
temp ACL, use a unique agent-owned `D:/ClawX/.tmp` profile and record its recovery archive.
Retain only curated final evidence under
`harness/specs/fixtures/product-acceptance-closeout/b1-space-bunny/`, with complete
manifest, source/build fingerprints and credential scan. A preparation-time credential
output incident is a distinct limitation and cannot be retroactively erased by a clean
artifact scan. Raw private Task Forest data remains outside Git.

The evidence is Windows x64 source-host, agent-driven and bound to this local provider.
It does not prove general model quality, image support, other providers/platforms,
packaged/installed behavior or GA. `releaseApproved`, `productApproved`, `liveReady` and
`defaultOn` remain false; retired Runtime Memory flags stay retired. Do not start TF-0581
or modify the original `moyu` project in this node.
