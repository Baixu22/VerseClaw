# Desktop acceptance follow-ups

`driven_by: agent` · `actor: codex-desktop-followups`

TF-0255–0258 cover Windows dependency delivery, automated approval/recovery,
startup loading and the previously disconnected desktop controls. Current
results and their candidate identities belong in
[`artifacts/desktop-acceptance-followups/report.json`](../../artifacts/desktop-acceptance-followups/report.json).
Private run logs, screenshots and receipts remain under
`.local/desktop-followups-20261006/` with a recovery index.

## Final verification

The Windows package was built from `1aa238c92cf3dda37bec0f8564ab714e3f160d43`.
Candidate `3ef9b34a1b3297470fd60e65eba4c8b9be2d97b3` only changes the manual
compression test fixture and task-spec path ownership; product sources are
unchanged. The fixture now reloads after installing Host API stubs and waits
for the actual compression status before clicking.

- Root `pnpm test`: 8,040 passed, 50 skipped, zero failed; exit 0.
- Full Electron run: 333 passed, 4 skipped, 2 failed in 49.8 minutes. The two
  failures were the early compression click and a Windows worker crash in the
  memory-injection panel. Both files then passed all 4 tests on the clean
  candidate. This is a recorded full run plus a targeted rerun, not a claim
  that one full invocation was green. The crashed worker's owned Electron
  process was identified and stopped after the suite to release its log pipe.
- Scheduled/Browser, Knowledge Hub, checkpoints, Git controls, compression
  evidence, model scopes, startup, math and offline token history ran in the
  full suite. The four existing skips are two paid-provider cache probes,
  macOS-only drag regions, and an opt-in screenshot collection utility.
- Agent-driven RC-10 H-02 through H-06 passed. Both Gateway restart scenarios
  changed PID; all 15 evidence-file hashes match. The model/account sequence
  is A, C, B, C, A through real local Main/Gateway requests.
- Startup remains 1.53 MB against the unchanged 2.50 MB limit; chat adds
  3.17 MB against the unchanged 4 MB limit.
- NSIS completed with exit 0. The installer is 552,500,868 bytes with SHA-256
  `51dde554890d9ac1b50738be5f2d6ac7d6eb24da582d21e4101ad034a9611c0d`.
  Extraction contains zero external links; 4,174 dependency checks pass.
  Main ASAR integrity and all 12 native companions match. MCP, guarded
  Gateway startup, and the actual delivered desktop renderer were exercised.

The packaged desktop probe uses E2E mode to suppress startup side effects;
its screenshot therefore shows Gateway stopped. The packaged Gateway is
verified separately. Earlier probe connection/exit failures remain in the
report. A successful rerun does not establish the absence of intermittent
Windows process failures.

Candidate run output was moved to
`D:/ClawX-work/desktop-followups-20261006/evidence`; the previous C: output
directory is a junction. The installer and extracted delivery are adjacent
under `release-final/` and `delivery-final/`, and new temporary files use
the D: task `tmp/` directory. Source checkouts and unrelated branding work
were preserved. The machine-readable report contains the recovery index,
all command receipts, final control-plane gate results and scope exclusions.

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
