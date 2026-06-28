# Phase 23 Window Prompts

## Lane A Prompt

Read the Phase 23 spec and command script. Verify command/help wording establishes readonly/default-off, explicit `--persist`, explicit `--read-shadow`, explicit `--database <path>`, diagnostics-only output, and no runtime/durable fact authority.

## Lane B Prompt

Read the command script, helper, and command tests. Verify no SQLite open/create occurs until `--persist`, `--read-shadow`, and `--database <path>` are all explicit; missing DB files remain missing; unrelated DBs do not receive Runtime Memory tables.

## Lane C Prompt

Read the command script, Phase 22 build proof, helper, and tests. Verify the command imports the built helper and explicit existing Runtime Memory DB output is bounded, sanitized, diagnostics-only, readonly, and non-authoritative.

## Lane D Prompt

Search package lifecycle scripts and product runtime paths. Verify Phase 23 adds no Gateway/Electron/renderer/shared/host-api/api-client/provider/TaskLoop/prompt/model/runtime cutover.

## Lane E Prompt

Verify rollback, docs sync review, harness context/validate, structural validates, focused tests, narrow builds, typecheck, boundary scans, and comms decision. The synthesis owner must re-check lanes rather than copying claims.
