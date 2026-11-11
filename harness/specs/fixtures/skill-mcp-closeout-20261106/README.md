# Skill/MCP closeout evidence

- driven_by: agent; actor: codex-skill-mcp-closeout; date: 2026-11-06.
- Candidate: 458a1570b7e3b7684699135b7cc4c28febd0ea7a, clean at final verification.
- 123 unit/protocol tests and one real Electron scenario passed; no skips.
- Scope: canonical Skill config, legacy migration, managed directory, install failure propagation, selected SDK v1.32.2 update.
- Not claimed: MCP v2/remote Skills, packaged release, real-model quality, public deployment.

Read report.json for commands, identities, counts and whole-repository limitations.
The prior audit in ../skill-mcp-handling-20261105 remains unchanged; its failing
boundary probe describes the old code.

From the repository root, set TEMP/TMP to an allowed D: scratch directory and run:

```powershell
node openclaw_runtime/node_modules/tsx/dist/cli.mjs --tsconfig openclaw_runtime/tsconfig.json harness/specs/fixtures/skill-mcp-closeout-20261106/verify-runtime.mts <output.json>
node node_modules/@typescript/native-preview/bin/tsgo.js -p harness/specs/fixtures/skill-mcp-closeout-20261106/tsconfig.tests.json
```

SHA256SUMS covers every file here except itself. sources.json binds the
implementation inputs to the candidate. The runtime probe uses isolated test data.
