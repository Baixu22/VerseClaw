# Privacy / Retention Boundary

Production-entry evidence is non-persistent for candidate, shadow, and replay text.

Allowed retained evidence:

- sample ID,
- status,
- diagnostic code,
- pass/fail,
- content hash,
- content length,
- token estimate,
- prompt-present exclusion count,
- provider ordering drift count,
- leakage count,
- rollback success,
- command/scans run,
- evidence file references.

Forbidden retained evidence:

- candidate text,
- shadow/replay text,
- raw model messages,
- Gateway requests,
- provider transport payloads,
- default reviewer prompt containing candidate content,
- lifecycle/checkpoint payloads containing candidate content,
- localStorage/indexedDB/electron-store candidate state,
- SQLite/Postgres/MySQL/Redis candidate state,
- sidecar files, queues, or stream-writer candidate output.

No privacy cleanup is needed for normal rollback because no candidate/shadow/replay text is persisted.
