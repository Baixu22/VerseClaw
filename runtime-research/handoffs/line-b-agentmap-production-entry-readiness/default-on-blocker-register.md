# Default-on Blocker Register

Default-on/default cutover is blocked in this task.

| Blocker | Required future evidence |
|---|---|
| Limited production telemetry is not yet collected | Future limited opt-in synthesis with real opt-in metrics. |
| Default runtime behavior parity must be re-proven under production traffic | Future default-on task spec and replay proof. |
| Provider ordering must be revalidated under default-on proposal | Future provider-ordering proof. |
| Candidate leakage must be revalidated with production telemetry | Future sentinel/leakage proof. |
| Rollback must include production incident process | Future rollback drill and operator incident runbook. |
| User-visible or production UI is not approved | Future UI spec, i18n, E2E, and docs if proposed. |
| Runtime authority remains forbidden | Future security/authority review must still prove no authority or explicitly reject cutover. |
| Persistence remains forbidden | Future persistence proposal would need separate privacy, retention, deletion, and rollback plan. |

Default-on requires a future independent task spec, independent synthesis, independent validation, and explicit approval. This package must answer "no" for default-on/default cutover.
