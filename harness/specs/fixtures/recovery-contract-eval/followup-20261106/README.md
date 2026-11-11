# Recovery follow-up evidence — 2026-11-06

Agent-driven only: driven_by=agent, actor=recovery-followup, realHumanEvidence=false.

This is a bounded defect-fix follow-up to commit 17b3bcbbb. It does not replace final-20261105 or claim a complete frozen evaluation pass. Product defaults, retries and acceptance thresholds are unchanged. The overall decision remains NO-GO.

raw-evidence.json.gz contains immutable captured trial receipts and artifacts, every attempted stage, gate logs, structured reviews and source bytes. report.json summarizes stages separately, including pre-injection failures and incomplete sequences. Each raw file and source has a SHA-256 digest. HASHES.json covers the retained package except itself. credential-scan.json records the decoded-archive and exact authorized credential scan without storing any key. verification.json records offline bundle validation and a deliberate tamper rejection against a separate copy.

Stage names preserve implementation provenance: matrix is before startup ordering; startup-fixed still uses the rejected timestamp heuristic; identity-fixed is the stable-identity initial build; identity-retry is resource gating only; owner-fixed includes the lifecycle/post-run metadata/RPC/warmup fixes; owner-final also protects sibling CLI metadata writers. Targeted smoke outcomes are not pooled into the original primary metrics.

See docs/dev/recovery-contract/FOLLOWUP-20261106.zh-CN.md for the final review status, measured timings and remaining acceptance gaps.
