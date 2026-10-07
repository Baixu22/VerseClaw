# Frozen Windows acceptance — 2026-10-07

`driven_by: agent` · `actor: codex-frozen-acceptance`

Product candidate: `cb33fad04fb3e98d0cd252f5f61afb542db7c349`.
Validation is in progress. Delivery is currently **not accepted**: a full-suite
worker native exit recurred, and the installed CLI's `--version` route was found
to start Gateway instead of reporting a version. The unexpected process was
stopped; original observations are retained. No release is authorized.

Raw evidence is under `D:/ClawX-work/frozen-acceptance-20261007/`. The final report
will distinguish full-suite failures, focused reruns, package integrity and the
non-elevated current-user installer lifecycle. Replacing one alpha candidate with
another at the same version does not prove cross-version data migration.
