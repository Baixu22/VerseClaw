# Lane C: No-Open No-Create Boundary

## Evidence

- The helper still requires `runtime.memory.persist === true` and an explicit database path before opening SQLite.
- Utility tests cover no `--persist`, `--persist` without `--database`, explicit missing database path, and existing unrelated database without `runtime_memory_episodes`.
- The tests assert missing database files remain absent and unrelated databases do not gain Runtime Memory tables or meta rows.

## Accepted Scope

Accepted bounded skipped diagnostics and no-open/no-create/no-write behavior for disabled or incomplete utility inputs.

## Rejected Scope

Rejected any utility migration, schema creation, write transaction, default persistence enablement, or runtime memory authority.

## Validation

Pending final validation synthesis.

## Status

Status: accepted
