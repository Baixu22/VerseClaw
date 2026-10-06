# Desktop acceptance follow-ups

`driven_by: agent` · `actor: codex-desktop-followups`

TF-0255–0258 cover Windows dependency delivery, automated approval/recovery,
startup loading and the previously disconnected desktop controls. Current
results and their candidate identities belong in
[`artifacts/desktop-acceptance-followups/report.json`](../../artifacts/desktop-acceptance-followups/report.json).
Private run logs, screenshots and receipts remain under
`.local/desktop-followups-20261006/` with a recovery index.

## Delivery

Runtime copies materialize Windows junctions and start dependency traversal from
the source workspace's installed direct dependencies. The MCP adapter receives
its complete installed dependency graph and exposes MCP `inputSchema` entries.
Main dependencies are stored in `main-runtime.asar`; electron-builder includes
its header hash in embedded ASAR integrity. Main's CommonJS and ESM imports use
that archive, including imports made with `createRequire`. Native companions are
unpacked and checked before packaging. Built Main imports must be declared as
production dependencies; moving TypeBox and PDF.js to that category retains
their existing lockfile versions and package snapshots.

## Runtime and desktop behavior

A one-turn model selection wins over a stored session choice and is kept through
queue refreshes. It does not replace the stored model or the user's selected
authentication profile. Session responses expose the configured override
separately from last-used model metadata. The real Gateway test uses a local
scripted provider and checks both model and account sequence A, C, B, C, A.
Its user-choice fixture is agent-driven; it is not real-human evidence.

SQLite opens deep Windows profile paths using extended paths. Gateway shutdown
falls back to its owned native process handle when Windows process enumeration
fails, and does not release ownership before exit. Approval/recovery evidence
records process identities as well as decisions, receipts and continuation.

Checkpoint restoration, Git controls, compression evidence and model scopes use
the existing host API and components. Git menus stay within the viewport. Local
usage history is available with Gateway stopped. The existing startup budgets
remain unchanged; heavy math/editor/document assets stay off the initial path.

## Historical inputs retained without changing their verdicts

Two existing local inputs were omitted from source control during earlier
artifact retention work. They are now retained byte-for-byte:

- `artifacts/uas-06-single-local-exec-canary/live-observations.json` is the existing
  empty observation marker from commit `e28bc2d47fb9f0aa46d7eab6754affa244286d80`.
  An empty observation list is not a measurement or a new canary pass.
- `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml`
  is explicitly marked `driven_by: agent`, `actor: rc10-agent`. Its legacy filename
  is retained for compatibility. It references the historical candidate
  `a1bd8d8cc3c8463bd787f6729f5ff6a2a7407240`; its manifest and report hashes match
  the already tracked historical files. It is not a verdict for this change.

Task Forest history and session journals remain local. These repairs do not
authorize publication, change product locks, enable default-on features, or
establish cross-platform, paid-model or install/upgrade acceptance.
