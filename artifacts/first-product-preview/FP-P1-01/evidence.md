# FP-P1-01 evidence — Setup provider/model verification

Date: 2026-07-26, ClawX-maturity-p0 @ main working tree.

## Implementation surface

- Setup flow now `Welcome → Runtime → Installing → Provider(验证) → Model(验证) → Complete`
  (`src/pages/Setup/index.tsx` STEP enum; Workspace step lands with FP-P1-02).
- `src/pages/Setup/ProviderModelSteps.tsx` — Provider/Model steps reusing the Settings
  provider stack (`useProviderStore.validateAccountApiKey/listAccountModels/createAccount/
  setDefaultAccount` → electron `providers-api` → `provider-validation` real network probes).
- `src/lib/setup-provider.ts` — pure helpers: failure classification
  (not-filled/credentials/network/service), chat readiness gate, verified-complete rule.
- Sanitized persistence (no key material): AppSettings/SettingsSnapshot new key
  `setupProviderVerification`; provider account `metadata.validation`.
- Chat first-send gate: `src/pages/Chat/ChatInput.tsx` intercepts send with a guidance
  dialog (`chat-provider-gate-dialog`) when no usable provider exists; CTA navigates to
  `/settings/models`.
- Skip retained: records `status:'skipped'`; Complete page shows limited-mode banner
  (`setup-complete-unverified`).
- i18n: en/zh full copy; ja/ru keys present (English placeholder, consistent with
  existing FP-P4-07 policy). `pnpm i18n:lint` passed.

## Decision (E2E strategy, hard-lock compliant)

The E2E does NOT mock the validation request. It runs a REAL local HTTP server
implementing the OpenAI-compatible `/models` surface; electron-main's
provider-validation performs actual network fetches against it. 401 comes from the
real server; network-unreachable from a really closed port. This is the FP-P1-07
sanctioned "真 gateway/真请求 + 本地端点" pattern.

## Test runs

- Unit: `pnpm exec vitest run tests/unit/setup-provider-validation.test.ts` →
  **1 file / 22 passed / 0 failed**
- E2E: `pnpm run test:e2e:run tests/e2e/setup-first-run-fp-p1-01.spec.ts --workers=1` →
  **2 passed (1.3m)**
```
[fp-p1-01-verification] {"status":"verified","accountId":"custom-64f38d27-9853-4c19-ad59-f355b8b6ea37","vendorId":"custom","model":"mock-coder-small","checkedAt":"2026-07-26T11:21:19.096Z"}
  ok 1 › verified path plus all three failure classes in the Provider step (46.3s)
[fp-p1-01-skip] {"status":"skipped"}
  ok 2 › skip path: limited-mode Complete state and chat first-send interception (31.5s)
```
  The verified-path test asserts in-UI: not-filled error → credentials error (real 401)
  → network error (closed port) → validated → model listed live → confirmed → Complete
  WITHOUT limited-mode banner; and `JSON.stringify(verification)` contains no key.
  The skip-path test asserts: skipped status persisted host-side + chat send intercepted
  by the provider gate dialog in a real Electron with a real running gateway.
- `pnpm contract:check` → passed. `pnpm i18n:lint` → passed.
- `tsc -p tsconfig.web.json` → exit 0.
- `git diff --check` on all touched files → clean.

## Drift note

`tsc --noEmit -p tsconfig.node.json` full (non-incremental) run fails with ~93
pre-existing TS6307 composite-project errors, reproduced on a CLEAN worktree of HEAD
(60931957b) — not introduced by FP-P1. The FP-P0 acceptance's "exit 0" was an
incremental-cache pass. Recorded here; repo-level hygiene remains FP-P3-01 territory.
