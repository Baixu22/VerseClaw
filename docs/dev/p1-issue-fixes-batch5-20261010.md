# P1 batch 5: evidence paths, repository artifacts and public identity

- Date: 2026-10-10
- Issues: #63, #68, #77, #84, #85, #88, #92
- driven_by: agent
- actor: codex-p1-batch5

## Implemented behavior

1. **#92** - added `scripts/check-evidence-refs.mjs` and a unit test; replaced
   the stale `src/lib/api-client.ts` references in active source, harness,
   scripts and docs with the real `src/lib/host-api-client.ts`.
2. **#63/#68** - the existing repository artifact gate now runs clean on this
   candidate (zero tracked-and-ignored paths). Durable P1 docs are explicit
   retained files instead of shadow-tracked outputs.
3. **#77** - check, comms, harness, security and Electron E2E workflows now
   include `codex/**` push triggers.
4. **#84** - internal `icnnp7d0dymg.feishu.cn` help URLs were replaced with
   public `https://docs.openclaw.ai/`.
5. **#85** - OpenRouter attribution uses `https://verseclaw.dev` and
   `Verse Claw` consistently; the preload path is environment-overridable.
6. **#88** - exact stale `'ClawX'` literals in the identified active surfaces
   were replaced with `'Verse Claw'`.

## Verification boundary

Checks are static and local. Codex-branch workflow triggers were added but not
executed by a remote CI run; no packaged release or public repository operation
is claimed.
