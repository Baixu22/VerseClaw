# P2 issue batch 3: skill install byte identity, tool disclosure, snapshot skill limits

Date: 2026-10-10 (agent-driven)
Base: private `main` = `3c1f2e926` ("fix(app,gateway,repo): close P2 batch 2")
Issues closed by this change: **#131, #105, #104** (all `[P2]`).

This batch fixes one install-integrity defect that crossed the renderer -> Main
path and two runtime prompt-projection defects. No tool policy, allowlist,
product default value, feature flag, product lock, packaged artifact or release
state changes, and no claim of human execution is made anywhere here.

## #131 - skill install ignored the requested version and recorded catalog metadata as the installed version

**Reported:** the installer fixed `main`/`master`, never used the requested
version, and wrote the built-in catalog's declared version into
`.clawhub/origin.json` as `installedVersion`, so nothing tied the displayed
version to the bytes that had been downloaded.

**Verified at HEAD:** `installSkillFromCatalog(skill, _version)` ignored its
second parameter (the store and the host handler both forwarded one),
`buildGitHubUrl(github, _branch)` dropped its ref argument, the ZIP fallback used
`refs/heads/<branch>` unconditionally, `origin.json` contained only
`{slug, installedVersion, github, installedAt}`, and both the Main handler
(`electron/services/skills-api.ts`) and the renderer store enabled the skill
immediately after the download returned. `electron/gateway/clawhub.ts` then
displayed `origin.json.installedVersion` as the installed version.

**Change**

- `electron/gateway/skill-installer.ts` now treats the bytes on disk as the only
  trusted artifact:
  - a requested version is turned into candidate git refs (`1.2.0`, `v1.2.0`) and
    honored when one resolves; otherwise the installer tracks `main`/`master` and
    records `requestedVersionStatus: "unresolved"` plus a `console.warn` instead of
    silently pretending the request was satisfied;
  - `InstalledSkillIdentity` records `declaredCatalogVersion` (source metadata,
    explicitly not a byte claim), `requestedVersion`/`requestedVersionStatus`,
    `installSource` (`git-clone` | `zip-archive`), `trackedRef`/`trackedRefKind`,
    `resolvedRevision` (git `rev-parse HEAD`) and a deterministic
    `contentDigest` (`sha256` over sorted relative paths plus file bytes,
    excluding `.clawhub` installer metadata and `.git` internals);
  - `installedVersion` is now written only when the installed bytes themselves
    declare a version (`package.json` / `manifest.json`), with
    `installedVersionSource: "installed-package-json" | "unavailable"`;
  - the install fails closed: the digest is read back through
    `verifyInstalledSkillIntegrity()` and a mismatch removes the directory and
    throws, so a partially trusted install can never be enabled;
  - `resolveInstalledSkillDir(slug)` centralizes the safe slug -> directory
    resolution used by the verification gate.
- `electron/services/skills-api.ts` forwards the requested version
  (`getRequestedVersion`, bounded to 120 chars) and verifies integrity before
  `updateSkillConfig(slug, { enabled: true })`; an unverifiable install returns
  `success: false` and the skill stays disabled.
- `electron/gateway/clawhub.ts` keeps reading `installedVersion` (now
  bytes-derived) and only falls back to `declaredCatalogVersion` when no on-disk
  version can be found, so catalog metadata never overrides a traceable value.

**Tests:** `tests/unit/skill-installer-identity.test.ts` (7) covers requested-ref
honoring, recorded `unresolved` outcome, no fabricated installed version, the
archive fallback and its HTTP-failure path, digest determinism/exclusions, every
`verifyInstalledSkillIntegrity` state, and the fail-closed removal path (digest
mismatch forced at the crypto boundary). `tests/unit/skills-api-install-trust-gate.test.ts`
(4) covers version forwarding, the integrity gate, and the catalog allowlist.
`tests/unit/skills-errors.test.ts` (+2) proves the renderer store never enables a
skill whose install result failed. All fixtures are local: `child_process` and
`https` boundaries are mocked; no third-party repository is downloaded.

**Residual (recorded, not hidden):** a *reinstall* after uninstall can still
observe different bytes without an explicit re-trust prompt, because
`installSkillFromCatalog` refuses to overwrite an existing directory and there is
no persistent trust index. The install now records the digest, so such a
divergence is detectable and auditable, but adding a re-trust confirmation
surface (and the i18n/E2E it implies) is deliberately out of this batch's scope.

## #105 - system prompt advertised 18 tools for an empty allowlist

**Verified at HEAD:** `buildOpenClawToolFallbackText` hardcoded an 18-tool
catalog prefixed by "OpenClaw lists the standard tools above. This runtime
enables:", `shouldRenderOpenClawToolWorkflowHints` ignored its own `hasToolList`
argument, "Larger work: use `sessions_spawn`" was therefore emitted for a
read-only main surface, and the `gateway` / `session_status` guidance was
unconditional (or gated only on a timezone) even though the default subagent
policy denies both tools. All three production callers pass `toolNames` derived
from the real effective tool array, so an empty array is a known-empty surface,
not missing metadata.

**Change (bounded to prompt text; no capability or policy change)**

- `openclaw_runtime/src/agents/prompt-surface.ts` adds
  `buildOpenClawKnownEmptyToolListText()` and makes
  `shouldRenderOpenClawToolWorkflowHints()` require a rendered tool list.
- `openclaw_runtime/src/agents/system-prompt.ts` distinguishes
  `toolNames === undefined` (unknown metadata, legacy fallback retained) from an
  explicitly empty list (accurate "no tools are enabled for this run" text), and
  gates each positive instruction on the corresponding tool: `exec`/`process`
  for the long-wait hint, `sessions_spawn` for the spawn lines and the
  subagent-delegation surface, `subagents`/`sessions_list` for the polling hint,
  `gateway` for the Config/restart line, and `session_status` for the
  date/time advice.

**Tests:** `tests/unit/p2-105-tool-disclosure.test.ts` (7) pins the three
reported cases (empty embedded list, read-only main list, read-only subagent
list), the exec-only case, the retained legacy fallback for unavailable
metadata, and a fully populated list that must still render every tool, hint and
gateway section.

**Note:** with `toolNames` absent (metadata unavailable) the legacy catalog is
still rendered but the workflow hints are now suppressed; no production caller
omits `toolNames`, so this affects only legacy/external callers.

## #104 - snapshot-backed runs bypassed minimal/low skill catalog limits

**Verified at HEAD:** `resolveSkillsPromptForRun` only applied transient limits
when non-empty `entries` were supplied, while `resolveEmbeddedRunSkillEntries`
intentionally returns `shouldLoadSkillEntries: false` for snapshot-backed runs.
With a 20-skill snapshot, minimal kept 20 skills / 20 descriptions and low kept
20, i.e. zero saved prompt characters, and `runtimeIntensitySkillsTotal`
collapsed to the included count.

**Change**

- `openclaw_runtime/src/skills/loading/workspace.ts` factors the existing
  compact-paths -> limits -> render path into
  `projectSkillsPromptForResolvedSkills()` and uses it from
  `resolveWorkspaceSkillPromptState` (behaviour unchanged) and from a new branch
  in `resolveSkillsPromptForRun` that re-projects `skillsSnapshot.resolvedSkills`
  under the requested transient limits when entries were intentionally skipped.
  No filesystem rescan, no mutation of the reusable snapshot, canonical paths and
  filtering preserved, sandbox snapshot-discard behaviour untouched.
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` reports
  `runtimeIntensitySkillsTotal` from the effective projection
  (`promptSkillEntries?.length ?? skillsSnapshotForRun?.resolvedSkills?.length ?? included`)
  so a snapshot-backed minimal run reads 8/20 instead of 8/8.
  `policyAdherence` is deliberately unchanged: per
  `harness/specs/tasks/runtime-intensity-harness-parity.md` it describes harness
  *capability*, not skills trimming.

**Tests:** `tests/unit/p2-104-snapshot-skill-limits.test.ts` (7) covers
minimal 8 + compact / low 16 against a 20-skill snapshot, positive savings, the
no-transient control (snapshot prompt returned unchanged), the explicit-entries
control, byte-identical equivalence with a full rebuild, and snapshot
immutability. Red-before-green was recorded by temporarily restoring
`workspace.ts` to HEAD: the same file then reported `expected 20 to be 8`,
`expected 20 to be 16` and `expected 3577 to be greater than 3577` (0 saved
chars).

**Side effect (consistent with the parity spec):**
`openclaw_runtime/src/agents/cli-runner/prepare.ts` also passes a snapshot with
transient limits and no entries, so CLI-backed minimal/low runs now honour the
limits as well.

## Gates executed on the candidate (agent-driven)

| Gate | Command | Result |
| --- | --- | --- |
| Focused unit suites | `node node_modules/vitest/vitest.mjs run <11 files>` | 11 files / **68 tests passed**, exit 0 |
| Runtime colocated suites | `node ../node_modules/vitest/vitest.mjs run --config vitest.config.ts src/skills/loading/skill-contract.test.ts src/agents/tools/sessions-compact-tool.test.ts` | 2 files / **7 tests passed**, exit 0 |
| Typecheck (node/web/test) | `tsgo --noEmit -p tsconfig.{node,web,test}.json --composite false` | all exit 0 (after `node scripts/generate-ext-bridge.mjs`, see environment note) |
| Lint (changed files) | `node node_modules/eslint/bin/eslint.js <12 changed TS files>` | exit 0 |
| i18n lint | `node scripts/i18n-lint.mjs` | `i18n lint passed.`, exit 0 |
| Comms regression | `node scripts/comms/replay.mjs` + `node scripts/comms/compare.mjs` | exit 0, all metrics PASS (0.00% deltas) |
| Harness spec | `node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch3-20261010.md` | `Spec is valid`, exit 0 |
| Artifact retention | `node scripts/check-repository-artifacts.mjs` | see the evidence report |
| Whitespace | `git diff --check` | see the evidence report |

**Environment note:** the worktree had no gitignored generated extension bridge
(`electron/extensions/_ext-bridge.generated.ts`, `src/extensions/_ext-bridge.generated.ts`),
so the first `tsgo` run for the node/web projects failed with `TS2307` on those
two modules. Running the tracked `node scripts/generate-ext-bridge.mjs`
(`ext:bridge`) regenerated both stubs (they remain gitignored) and every project
then typechecked with exit 0. This is environment repair, not a product change.

**Not run:** full repository unit suite, full `harness:ci`, Electron E2E, Agent
Dev deep-test/audit, packaging, cross-platform checks, real provider calls, and
any real third-party skill download. No user-visible UI surface was changed, so
no E2E spec was added; the version label change in the installed-skill list is a
fallback-only path with unit coverage.

**Credentials:** the changed files and evidence are scanned for common credential
shapes by the evidence driver; results are recorded in
`credential-scan.json`. No real provider key, token or user data is used.

**Boundaries:** evidence is `driven_by: agent`; no human action, verdict or data
is claimed. `pnpm run <script>` cannot be used in the junction-based candidate
worktree (pre-run dependency verification aborts without a TTY), so the wrapped
`node` commands were invoked directly.
