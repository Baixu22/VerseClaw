# SEKB Hermes Tier B Findings

Generated from `b-gray-2026-07-14T16-32-03-287Z-a0ba48bd` at 2026-07-14T16:32:04Z.

## P0 (blocking Tier C traffic/stability)

None observed in the latest local canary.

## P1 (non-blocking; track)

- **high_shadow_retain_ratio**: Expected while capture value != task success; do not retune Shadow V1 threshold in Tier B.

### Additional watch items for real multi-day grayscale

1. **Classifier collapse on real GUI traffic** — current inventory is smoke-scenario task_types (`docs/config`, `config/db`, ...). Real embedded-agent traffic may still collapse to `agent/task`; re-run observe after real users.
2. **State-dir split-brain** — home `~/.openclaw` previously had SEKB enabled with 0 rows while Electron held data. Inventory/enable now default to Electron; disable home when not intentional.
3. **High retain ratio (100%)** — expected under Shadow V1 with current smoke evidence; do **not** retune threshold 50 in Tier B.
4. **Trajectory floor** — local canary has 105 rows (>=100). Prefer multi-day real-task growth toward 200+ before heavy dual-review staffing.

## Blocks Tier C?

**No P0 blockers** for starting a human dual-review campaign from a traffic/stability perspective on this canary.

Still **not** promotion-ready: human dual review, kappa, and holdout gates remain open. `evaluable_for_promotion` stays false.

## Conclusion

Tier B local canary demonstrates:

- opt-in enable/disable
- export/sqlite count parity on Electron OPENCLAW_STATE_DIR
- privacy-bounded export
- honest offline report status (`insufficient_data` with unfilled reviews)
- honest operator batch metrics (`unavailable` / `no_batch_evidence`)
- promotion remains shadow_only

Ready to enter **Tier C dual-review planning** once multi-day real traffic confirms the same premises (recommended), not to claim production-enabled benefit.
