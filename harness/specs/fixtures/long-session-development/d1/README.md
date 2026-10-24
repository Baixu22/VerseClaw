# D1 accepted continuity context evidence

- Candidate source: `faf92352eea9b516a3ed15c6ed58c8da9378185d`; working-tree source hash `ea7b57dfab3e906a7637b47ac891912639c80cee`.
- This node uses the existing Task Ledger, accepted role-memory owner, typed knowledge refs and CompressionArtifact; it creates no second memory store, task list or injection chain.
- The real built Electron journey exercised Host API -> Main -> Gateway -> owner reads. It found Task Ledger Working Context, accepted memory and a knowledge ref; the pending working-context item was excluded. The fresh session had no CompressionArtifact, so the pack honestly remained `partial`.
- Unit coverage excludes candidates, expired items, tombstones, superseded items, closed role-memory gates, foreign workspace/role/agent scopes and unverified model claims. It also verifies fork, handoff, compact, restart refs, coordinator generation invalidation and native compaction ownership.
- The D1 unit suite covers production and owner-boundary behavior, and the built Electron test is current-candidate evidence. The historical D1 verdict was not reused.
- Known unmeasured boundaries: live native/CLI provider quality, real compression generated during the E2E run and a live provider process kill. No hidden fallback is claimed.
- Every artifact is agent-driven (`driven_by: agent`), actor `codex-long-session-r2`. No real-human evidence is claimed.

## Primary artifacts

- `continuity-context-pack.json`: bounded owner-derived pack from the built Electron run.
- `fact-provenance-and-revocation.json`: source, freshness, scope, trust, evidence and exclusion matrix.
- `cross-scope-negative.json`: missing binding and deleted-session generation invalidation.
- `verification.json`: commands, exits, acceptance mapping, cleanup and unmeasured boundaries.
- `gates.json`: current gate status.
- `SHA256SUMS`: retained-file manifest.

Raw Playwright output remains at `D:/tmp/tf0556-e2e-output-2`; only these selected artifacts are retained in source.
