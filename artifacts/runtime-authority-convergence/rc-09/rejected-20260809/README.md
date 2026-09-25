# RC-09 rejected evidence — 2026-08-09 generation

Read-only archive. Do not overwrite, refresh, or reuse as green evidence.

## Provenance

These two files were the RC-09 final acceptance evidence recorded on 2026-08-09
against candidate `3209f098105080effd4789baee3ef644793c50da` (branch
`rc09-final-candidate`, tree `5f9c3ead8fd8344f21c09d8b953da6ad41e59212`),
baseRef `b8a6c1832ef7aca6c7d6286f80f5aee74c6e5d2c`, 99 changed paths.

They are superseded. The RC chain they describe was rebuilt: candidate
`fac6327a2` and its generation were judged `NO-GO` by the 2026-08-03 independent
audit (`TFD-RC09-HISTORICAL-20260803`), and RC-00R..RC-08B were subsequently
re-verified on the shared integration branch `feat/runtime-lifecycle-governance`.

## Why they are here

The RC-09 acceptance protocol fixes its output paths at
`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/`.
`RC-09-REMEDIATION-PLAN.md` §18.3 requires a never-used output directory and §20
requires old rejected evidence to be preserved read-only rather than overwritten,
so the 2026-09-25 rerun archives these files here first.

`changed-path-ownership.json` was **not** archived with them: the copy in the
final directory is current evidence regenerated on 2026-09-25 against the new
accepted base `1cddcb1ba5e23ebe445afca11174c2575c75f735`
(schema `runtime-authority-convergence-rc09-ownership/v2`).

## Related records

- `TFD-RC09-HISTORICAL-20260803` — the rejected/historical verdict.
- `TFD-RC09-SCOPE-20260925` — the ownership-scope amendment and accepted-base
  re-anchor that unblocked the rerun.
- `docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md` (RC-09).
