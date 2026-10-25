# TF-0493 scoped integrity evidence

- Clean candidate: `97aae5dc26bb5aa9a4d56dd3f0df0f172ba7d9b5`, tree `0132f6311f3be34079e14ce475bfc5cef0daac00`.
- The contract ledger is `../verification.json`; all 13 gates pass and all SHA256 entries verify.
- Cross-layer receipts cover i18n, comms replay/compare, Harness validate and dry-run, artifact retention, whitespace and credential scan.
- TF-0494 workspace-context default changes and its separate UI/evidence were explicitly removed. Product defaults remain opt-in.
- Cleanup: zero Electron process survivors and no remaining run-root entries.
