---
id: local-data-fail-closed-config
title: Corrupt local config must fail closed, never degrade to an empty projection
type: ai-coding-rule
severity: error
pathPatterns:
  - electron/utils/**
  - electron/services/**
  - openclaw_runtime/src/infra/**
appliesTo:
  - local-data-protection
requiredProfiles:
  - fast
driven_by: agent
touchedAreas:
  - electron/services/secrets/auth-profile-secret-broker.ts
  - electron/services/secrets/wechat-account-secret-broker.ts
  - electron/services/providers/store-instance.ts
  - electron/services/backup-restore.ts
  - electron/services/app-api.ts
  - src/lib/host-api.ts
  - shared/host-api/contract.ts
  - electron/services/knowledge-api.ts
  - electron/utils/durable-store.ts
  - electron/utils/log-retention.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/wechat-login.ts
  - shared/types/tar.d.ts
  - tests/tar.d.ts
  - tests/unit/local-data-secret-brokers.test.ts
  - tests/unit/local-data-fail-closed-config.test.ts
  - tests/unit/local-data-backup-restore.test.ts
  - tests/unit/local-data-log-retention.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/wechat-login.test.ts
  - harness/specs/rules/local-data-fail-closed-config.md
  - eslint.config.mjs
---

# Local configuration durability and corruption policy

## Why

Most Verse Claw config stores (`openclaw.json`, `agents/<id>/auth-profiles.json`,
`knowledge/watched-directories.json`, `settings.json`) are rewritten through a
read-modify-write cycle: read the current object, mutate one field, write the whole
object back. If the read path degrades a corrupt or unreadable file into an empty
projection (`{}` or `[]`), the very next write persists that empty projection and
silently destroys every unrelated key the user had configured — with no error shown.

This failure mode is silent, total for that file, and only discovered long after the
data is gone. It is the highest-severity durability bug in the local data layer.

## Rule

**Any config store that is rewritten through read-modify-write must fail closed on
corruption.** Concretely:

- **Never** return an empty object/array as a substitute for a corrupt or unreadable
  config that exists on disk. Throw instead.
- Reads must go through the atomic helpers in `electron/utils/atomic-write.ts`
  (`readJsonAtomic`) or the runtime's durable equivalents
  (`readDurableJsonFile` / `readJsonFileStrict`), which recover from the `.bak`
  sibling when the primary is corrupt or missing.
- A genuinely absent file may yield an empty projection (nothing to lose). That
  distinction must be explicit, not a blanket `catch { return [] }`.
- Writes must stay atomic: temp file, fsync, rename, with the previous good content
  retained as `.bak`. See the atomic-write contract.
- Read-modify-write cycles must hold the cross-process file lock so concurrent
  writers cannot lose updates.

`openclaw.json` already follows this policy (`channel-config.ts` throws
`AtomicWriteError { code: 'CORRUPT' }` rather than returning `{}`).
`auth-profiles.json` and the knowledge configuration follow the same rule; the
`catch { return [] }` shape is a defect, not a fallback.

## Credential handling

Credentials are a separate axis from durability and follow a stricter rule:
provider API keys, OAuth access/refresh tokens, channel secrets, and MCP env values
must never be persisted as plaintext in a plain-JSON store. Use the SOPS-style
pattern already established in `electron/services/secrets/`: the value is sealed
into the vault as a safeStorage envelope, and the source file keeps only a reference.
A credential field must accept legacy plaintext on read (migration compatibility)
and seal it on first read so the migration is self-healing and idempotent.

Credentials that must remain plaintext because a separate process reads them at
bootstrap — notably `gateway.auth.token`, which the Gateway resolves before its
secret provider initialises — must be delivered through an environment channel
(`OPENCLAW_GATEWAY_TOKEN`) rather than duplicated into config.

## Tests

`tests/unit/local-data-fail-closed-config.test.ts` and
`tests/unit/local-data-secret-brokers.test.ts` are the regression net: corruption,
`.bak` recovery, missing-primary recovery, concurrent-write serialisation, sealed
round-trip, idempotent migration, reference ownership, and canary scans for
plaintext credential leakage.