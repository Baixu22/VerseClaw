# TF-0741 Memory self-edit provenance

Agent-driven development acceptance for candidate `1e6e03cc73dc9da6b34f6555b5efd3cb630cd231`.

Model edits now use agent_self_edit / agent_approved / promotedBy agent.
Agent approval is not independent verification or human approval. Historical
human lineage is preserved, and strengthen changes usage only.

MEM-1 static labels: 5 -> 0.
Final owner API, schema/store and persistence-retirement tests: 71/71, no skips.
Targeted typecheck/lint, real-diff Harness, comms replay/compare, retention and
structured autoreview passed. Exact commands and hashes are in commands.json
and source-manifest.json; all evidence bytes are covered by SHA256SUMS.

Run the two required test commands in harness/specs/tasks/memory-self-edit-provenance.md.
The retained scope-tsconfig.json records this checkout's exact local paths;
for a relocated checkout replace those roots before running tsgo.
Harness comparison base: 7abbf58a3e1d4404f26076c54fd7ea00d75e26a3. Harness plan is dry-run only, not
execution of the broad fast profile. Dependencies were reused from D:/ClawX.

Persistence remains retired. No live model, GUI or real SQLite write was tested.
This closes the provenance prerequisite only; TF-0742..TF-0744 remain separate.
