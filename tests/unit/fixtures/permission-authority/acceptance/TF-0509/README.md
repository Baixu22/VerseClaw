# TF-0509 acceptance evidence

- Task: `TF-0509` — one permission, authorization and side-effect contract
- Actor: `codex`
- Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded
- Release boundary: public release, GA, liveReady and productApproved remain unclaimed

## Delivered contract

- `PermissionContract/v1` maps Browser, exec, Knowledge apply, Fact tools, Memory and coding control to one final permission authority.
- Component manifests describe consumers and boundaries; they cannot grant permissions or declare a second final authority.
- `CapabilityGrant/v1` remains a pure, process-local credential derived from the existing durable `ApprovalLedger`. No new grant/approval store was added.
- Every grant binds actor, session, task branch, resource, action, purpose, approval, policy digest, expiry and effect idempotency.
- Final execution rechecks current revocation/expiry state, so a snapshot authorized before revocation is denied at execution.
- Restart never revives an in-memory grant; active grants resolve to explicit invalidation.
- Each surface names an existing final checkpoint path; the test verifies that path exists.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| every side-effect component maps to one permission contract | `raw-evidence.json#authority`; `permission-contract-tf0509.test.ts` |
| manifest privilege expansion fails negative tests | `raw-evidence.json#manifestNegative`; `assertComponentManifestCannotGrantPermission` |
| actor/session/task/resource/action mismatch and revocation after snapshot fail at final checkpoint | `raw-evidence.json#finalCheckpointNegatives`; Stage4 contract tests |
| expired/revoked grants and restart state fail closed | `raw-evidence.json#expiryRevocationRestart`; Stage4 + RC-04 tests |
| Browser/exec/Knowledge/fact/Memory/coding use the same authorization boundary | `raw-evidence.json#surfaceCheckpoints`; cross-component suites |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/permission-authority/acceptance/TF-0509/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/permission-authority/acceptance/TF-0509/run-verification.ps1'
```

## Unverified boundary

This contract proves the authorization boundary and negative behavior. It does not add an OS sandbox, replace the existing approval owner, change production defaults, or claim Browser/exec production graduation; those remain later component nodes.
