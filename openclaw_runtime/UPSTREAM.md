# Vendored OpenClaw runtime

`openclaw_runtime/` is a vendored source tree, not a Git submodule and not the
npm `openclaw` package.

## Identity

- Upstream: `https://github.com/openclaw/openclaw`
- Vendored source version: `2026.6.2` (authoritative in `package.json`)
- Root npm dependency: `openclaw@2026.5.20`, intentionally used only as the
  packaged CLI compatibility bundle. It is not the source of truth for the
  vendored runtime.
- Local fork reason: Verse Claw builds a desktop Gateway/runtime from this tree
  and carries reviewed local integrations that do not exist upstream.

## Sync policy

1. Select an upstream release or commit and record its version and commit.
2. Compare the vendored tree against that upstream revision before copying.
3. Preserve Verse Claw patches in reviewed paths; do not overwrite local
   integrations silently.
4. Run runtime typecheck, unit tests, `check:import-cycles`,
   `check:deprecated-api-usage`, `deadcode:unused-files`, and
   `check:loc:baseline`. Refresh the checked-in offender snapshot with
   `check:loc:baseline:refresh` in the same change set as a reviewed source
   update; this keeps the 500-line limit and rejects later new or grown files.
5. Update this file and `PRUNE-MANIFEST.json` in the same change set.

The historical `PRUNE-MANIFEST.json` is a snapshot of the original import. It is
superseded as a description of current runtime contents; current contents are
the source tree, and `scripts/check-runtime-source-policy.mjs` verifies that the
manifest and this document stay aligned.

## Tracked build output

The `verseconf` WASM/browser bundles under `dist/` are tracked because the
desktop build consumes them as prebuilt runtime assets. They may only be
removed after a reproducible build replacement is wired into the normal build
and packaging path. The `.gitignore` exceptions for that directory are
therefore intentional; a policy check verifies that the exception remains paired
with the documented reason.

CodeGraph's tracked `dist` exception was removed on 2026-10-17 together with the
retired plugin. Only its frozen impact-parity fixture remains.
