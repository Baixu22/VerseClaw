# SEKB Hermes Tier C Usefulness Metrics

Missing metrics are **unavailable**. No estimates are substituted.

Restored from prior confirmed closed-loop (`92d58571-255e-4c2c-8a58-f65be2206337`); this refresh did **not** re-run confirm_and_save.

| Metric | Status | Value | Reason / note |
| --- | --- | --- | --- |
| `deterministic_suggest_human_accept_rate` | available | 1 | Session-scoped demo accept after human edit (prior confirmed closed-loop; not re-confirmed this fix) |
| `pre_confirm_edit_distance` | unavailable | - | deterministic_path_does_not_persist_original_vs_confirmed_text_distance |
| `duplicate_principle_rate` | unavailable | - | not_persisted |
| `post_confirm_retrieval_count` | available | 0 | - |
| `post_confirm_adoption_count` | available | 0 | - |
| `post_adoption_success` | available | 0 | - |
| `batch_acceptance_rate` | unavailable | - | no_batch_evidence |
| `batch_normalized_edit_distance` | unavailable | - | no_batch_evidence |
| `batch_fallback_count` | unavailable | - | no_batch_evidence |
| `batch_latency_ms` | unavailable | - | not_persisted |
| `sqlite_db_bytes` | available | 1871872 | - |
| `trajectory_count` | available | 312 | - |
| `principle_count` | available | 3 | - |
| `historical_suggestion_acceptance_rate` | unavailable | - | not_persisted |
| `batch_probe_user_visible_status` | available | feature_disabled | Explicit invoke only; ambient batch remains off |
