---
id: agent-browser-supervised-task-boundary
title: Agent Browser Supervised Task Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: Agent Browser supervised tasks remain approval-bound

## R1: Explicit approval before effects

Creating a task must persist it as `waiting-approval`. Main must not create a browser session, navigate, inspect page content, fill, click, press keys, or resolve Vault credentials until the user approves that exact persisted task. Approval must be single-use for a run; retry requires a new approval.

## R2: Approval cannot widen scope

The approval surface must render the persisted objective, initial origin, allowed domains, browser mode, and ordered action scope. The approval request may accept only the task id. Renderer-provided approval metadata must not replace or widen Main-owned task data.

## R3: Per-step network enforcement

Main must validate the initial URL and every later navigation target. Only ordinary public `http:` and `https:` URLs within the approved domain set are allowed. Private, loopback, link-local, metadata, local hostname, restricted scheme, redirect, and DNS-rebinding cases remain fail closed under the existing Agent Browser network policy.

## R4: Bounded and cancellable execution

Objective steps must be an explicit typed allow-list with bounded waits. The executor must check cancellation before and after each action. Cancel is the immediate kill path; it must prevent remaining steps and success verification from running.

Progress, completion, failure and controller cleanup must retain their captured run identity.
Pause aborts the current executor; resume and retry require a new approval. Late callbacks
from an earlier run cannot change the successor or remove its cancellation controller.

## R4a: Page grants and background requests keep their owner

Full access binds the actual tab and exact origin at approval time. Moving to another
origin or tab invalidates that binding; debugger attachment and caller payloads cannot
replace it. Unredacted network reads use the same binding as full-access tools.
Asynchronous reads retain the captured approval until their result is returned.
Revocation, expiry or a replacement approval prevents an earlier read from returning raw data.
The captured recorder must still own the current control session; debugger detachment
or replacement cannot validate a late result from the earlier connection.

A replay draft is consumed synchronously before network dispatch. Concurrent calls,
timeouts and unknown outcomes cannot reuse it. JS, SourceMap and replay fetches use
the existing session/profile proxy, including pinned destination addresses, per-request
authorization, upstream proxy routing and revocation. A missing or refusing owner must
never fall back to ambient fetch.

## R5: Verified outcome

A run may become `completed` only after its success condition produces a typed passed result. Unsupported, missing, timed-out, or mismatched conditions must fail with a stable reason code and an explainable redacted message. Opening the initial URL alone is never proof of success.

## R6: Secrets stay Main-owned

Tasks and Renderer-visible evidence may carry only Vault credential references and redacted metadata. Passwords, tokens, authorization headers, cookies, and filled secret values must not enter task persistence, logs, errors, screenshots, lineage, or host-api results.

## R7: Default-off and baseline parity

The existing browser runtime availability checks remain authoritative and must be revalidated in Main at execution time. Disabling browser control or supervised task execution must prevent new effects and return the baseline behavior without weakening existing task recovery or private-network denial.

## Validation

- `pnpm harness validate --spec harness/specs/tasks/browser-supervised-component-graduation.md`
- `pnpm contract:check`
- focused Agent Browser unit tests
- Electron E2E for approval, completion, failure, and cancellation
- `pnpm run comms:replay`
- `pnpm run comms:compare`
