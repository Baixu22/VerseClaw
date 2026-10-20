# KS E4 real-task cohort evidence

- Generated: 2026-10-20T15:11:52.822Z
- Driven by: agent (no real-human claim)
- Semantic provider: available (siliconflow-qwen3-embed-8b)

## Cohort summary

| Surface | Tasks | Hit@1 | Hit@3 | MRR |
|---|---:|---:|---:|---:|
| explicit-refs | 3 | 1.000 | 1.000 | 1.000 |
| automatic-retrieval | 3 | 1.000 | 1.000 | 1.000 |
| sekb-retrieval | 3 | 1.000 | 1.000 | 1.000 |

## Per-task results

| Surface | Task | Expected | Rank | Hit@1 | Hit@3 |
|---|---|---|---:|---:|---:|
| explicit-refs | TF-0453 | electron-run-root-recovery | 1 | yes | yes |
| explicit-refs | TF-0458 | sekb-confirm-provenance | 1 | yes | yes |
| explicit-refs | TF-0454 | dcs-catalog-drift | 1 | yes | yes |
| automatic-retrieval | TF-0453 | electron-run-root-recovery | 1 | yes | yes |
| automatic-retrieval | TF-0458 | sekb-confirm-provenance | 1 | yes | yes |
| automatic-retrieval | TF-0454 | dcs-catalog-drift | 1 | yes | yes |
| sekb-retrieval | TF-0453 | electron-run-root-recovery | 1 | yes | yes |
| sekb-retrieval | TF-0458 | sekb-confirm-provenance | 1 | yes | yes |
| sekb-retrieval | TF-0454 | dcs-catalog-drift | 1 | yes | yes |

Boundary: this is an agent-driven real-task cohort built from repository task records. It does not claim real-human usefulness, E5 soak, product approval, or default-on promotion.

## Reproduction

Run `SILICONFLOW_API_KEY=<redacted> pnpm --dir openclaw_runtime exec node --import tsx ../scripts/knowledge-e4-cohort.mts`. The key must come from the caller environment and is never written to this report.
