# C1 clean-candidate evidence

Candidate: `4432d6a9105c50c3c04896ce2542da57181b5f3b` (`8356f8acd3c200f0e9302318fdfe3489b5bb32dd`). Base: `c3aab743b626e8792db5c0480c9de8bcc9cc549c`.

Agent-driven evidence for the explicit long-session coordinator binding. The clean gate set includes 40 required baseline tests, 42 binding/chat/lifecycle tests, uncached typecheck, contract, comms replay/compare, Vite, harness validation, scoped lint and retention. A built Electron journey launches the app twice against the same isolated profile and verifies bind -> restart -> rename -> handoff -> archive -> restore -> manual pause through actual Main, Gateway, Git and Task Ledger owners.

The binding is metadata on the existing Workspace owner. It references existing Task Ledger nodes without changing their status, records canonical local/worktree facts and a revision, and rejects cross-workspace, missing-owner/session/task, duplicate-branch, active-run environment-switch and stale-revision cases. Chat send uses the bound root and fingerprint; reset generations fail closed. Handoff starts with a pending child generation and materializes it on the first real turn.

Limits: no live-provider turn was issued; managed-worktree selection is covered by owner-boundary tests rather than the local-checkout E2E, and live delete is covered by the lifecycle unit test because the isolated handoff fixture did not create sessions.json.
