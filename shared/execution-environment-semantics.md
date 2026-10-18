# Execution Environment Semantics (TF-0380)

Status: semantic contract only. TF-0380 does not change execution defaults.

An execution environment describes where work runs and what guarantee the
owner actually supplies:

- `backend`: `host`, `node`, `docker`, `ssh`, `verseshell`, `codex-native`
- `guarantee`: `policy`, `process`, `container`, `vm`, `os`
- `network`: `disabled`, `approval-required`, `enabled`, `local-only`
- `writableRoots`, `status` and `reason`

The backend name is not a guarantee. A provider record can say
`runtimeLevel: 'policy'` even when its name suggests a stronger backend; the
mapping preserves the owner-supplied level. If a strong provider is
unavailable, the backend is retained but the effective guarantee is `policy`
with an explicit reason — availability is never upgraded into a guarantee. A missing or invalid value is
rejected rather than upgraded.

## Non-goals

- Complete OS sandboxing.
- A new container runtime.
- Changing permission defaults, approval policy or product locks.
- Replacing existing sandbox providers or runtime events.

TF-0381 will connect this semantic model to policy and fail-closed behavior;
TF-0380 only freezes the vocabulary and mappings.
