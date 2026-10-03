# Preserved worktree source consolidation

This pass incorporates still-valid source changes from the preserved September
worktrees. Their original files and indexes remain in the private local recovery
archive; obsolete reports are not new acceptance evidence.

| Source work | Disposition |
| --- | --- |
| TF-0029 unblock draft | Retain sufficient host mutation timeout, accessible settings label and empty-session fallback. Discard early termination based on display state: `stopped` can be transient during automatic recovery. Keep the newer main Git MCP fixture permission contract. |
| RC-09 draft | Add candidate preflight to `full`, `run` and `verify`, sharing the final validator's candidate checks. Keep the newer closure-advance replay implementation. |
| RC-10 draft | Reuse receipt filtering, H-01 assessment, channel probe assessment, immutable seals and the read-only integrity CLI. Keep current H-01..H-06 and OPERATOR-ALL support; discard the obsolete two-scenario restriction. |
| Runtime/knowledge merge-closeout | Already present or superseded by main's later fixes. Do not restore older transcript lookup, SQLite initialization, review selection, schema or placeholder behavior. |
| Temporary acceptance checkout | Mass staged deletion is a test fixture, not a product deletion. Preserve it outside the mainline change set. |

## Execution and evidence

RC-09 execution preflight requires the clean planned source candidate and its exact
ownership matrix before installing dependencies or running gates. It does not need
a final report and does not grant acceptance. Final evidence replay after closure
continues to use the existing candidate-view and closure-advance checks.

RC-10 H-01 only counts version-1 source receipts for the current run. Its result
requires the workload to change from failing to passing, unchanged original test
files, selected/omitted lineage and paired context/wire digests. CHANNEL-PROBE
requires a configured, running and connected account plus a usable target; it does
not establish message delivery. H-02..H-06 remain owned by the operator driver.

The driver refuses an existing non-empty evidence directory. It closes Electron,
writes final logs and then seals the evidence exactly once. Credential scan hits
make the run fail. Existing archives and their hashes are not regenerated.

Read-only bundle integrity check:

```sh
node scripts/verify-rc10-evidence.mjs --evidence /path/to/evidence
```

An integrity result describes the supplied bytes, not provider quality, live
channel delivery or a new release verdict. This change does not modify frozen
product defaults or reopen historical acceptance.

The checker accepts both structured H-01 seals and the operator driver's flat
filename-to-digest map. A flat seal reports `credentialScan: not-recorded`; passing
its hashes does not synthesize a credential scan or alter the original archive.
