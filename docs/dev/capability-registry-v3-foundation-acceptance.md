# Capability Registry V3 Foundation Acceptance

## Scope

This record covers only V3-00 and V3-01 from
`capability-registry-v3-development-plan.md`:

- metadata contracts and terminology;
- static, redacted fixture corpus and direct-projection baseline;
- `CapabilityDescriptor` canonicalization, hashing, adapters, diagnostics, and
  in-memory shadow catalog.

It does not claim implementation or acceptance of V3-02 through V3-08.

## Boundary

The foundation has no runtime integration and no feature flag. It must not
change prompt construction, tool registration or execution, approval, retry,
MCP materialization, DCS, ArchiveHandle, storage, Host API, Electron, or UI.
Rollback is deletion of the unused metadata-only module; there is no data or
configuration migration.

## Baseline Method

The static fixture corpus models representative Skill, Tool, and Context
metadata. Its direct-projection estimate is `ceil(serialized character count /
4)`. This is a deterministic comparison heuristic, not provider token usage.
The fixture's expected category, namespace, and capability ids define the
contract Recall@k target for future resolver work; no production retrieval
metric is claimed.

## Acceptance Evidence

Acceptance run: 2026-08-14 on branch `codex/v3-capability-registry`, based on
`8306466d175016a938703c41125dc3a3dca68390`.

### Implementation

- Added the metadata-only `CapabilityDescriptor`, canonical JSON-safe
  serialization, SHA-256 hashing, Skill/Tool/Context adapters, and deterministic
  shadow catalog under `openclaw_runtime/src/capabilities/v3/`.
- Added the redacted V3-00 fixture corpus and deterministic direct-projection
  baseline. The baseline ranks only user-visible title, description, and trigger
  metadata; it does not use executor state or claim provider measurements.
- Added explicit diagnostics and tests for unsupported executor fields, invalid
  category/namespace paths, kind/id mismatch, duplicate ids, owner conflicts,
  malformed descriptors, metadata cycles, and stable input ordering.

### Reproducible Baseline

Command:

```text
pnpm --dir openclaw_runtime exec tsx -e "import { evaluateCapabilityRegistryV3Baseline } from './src/capabilities/v3/evaluation-baseline.ts'; console.log(JSON.stringify(evaluateCapabilityRegistryV3Baseline(), null, 2));"
```

Observed output:

| Measurement | Value |
|---|---:|
| Fixture count | 9 |
| Descriptor count | 9 |
| Direct projection characters | 2986 |
| Direct projection estimated tokens (`ceil(chars / 4)`) | 747 |
| Category top-1 | 1.0 |
| Workflow namespace top-1 | 1.0 |
| Capability top-1 | 1.0 |
| Direct projection hash | `sha256:136f6384211ab034c83fc5d9497c211c09b6ba2dcea97dbdaccc59230799c314` |
| Catalog snapshot hash | `sha256:dc2543f29e9dbbbfa5bf498db602f80bdf4f424e66d86f1019edbe38baf1bd0e` |

These are static fixture measurements and a deterministic ranking contract only.
They are not production Recall, provider token usage, TTFT, cache, or rollout
evidence.

### Validation Results

| Gate | Result | Notes |
|---|---|---|
| `node harness/src/cli.mjs context --spec harness/specs/tasks/capability-registry-v3-foundation.md` | PASS | Context resolved to the V3 task, scenario, rule, and relevant guides. |
| `node harness/src/cli.mjs validate --no-diff --spec harness/specs/tasks/capability-registry-v3-foundation.md` | PASS | Task spec structure and required fields are valid. |
| Strict Harness diff validation | RESIDUAL | Three pre-existing Task Forest export files are outside this task's `ownedPaths`/`touchedAreas`: `.agent-workbench/task-forest/exports/task-forest.graph.json`, `.agent-workbench/task-forest/exports/task-forest.html`, and `.agent-workbench/task-forest/graph/forest.json`. They were not changed or reverted by this task. |
| Focused runtime Vitest | PASS | 3 files, 15 tests passed. |
| Root `pnpm run lint:check` | PASS | 0 errors, 127 pre-existing warnings. |
| Targeted root ESLint for V3 files | PASS | No findings. |
| Targeted runtime oxlint for V3 files | PASS | No findings or warnings. |
| Root `pnpm run typecheck` | PASS | Node and web projects both exited 0. The script separately reports 1269 legacy test-type errors in observation mode; they do not fail this gate. |
| Runtime `pnpm --dir openclaw_runtime tsgo:core` | PASS | Passed after the runtime workspace dependency links completed their repair. |
| `git diff --check` | PASS | No whitespace errors. |

The runtime workspace briefly reported missing package links while pnpm was
repairing its isolated workspace layout. A forced offline reinstall also
encountered a missing optional `@zed-industries/codex-acp-win32-arm64` artifact,
but the subsequent normal command completed the links and the final core
typecheck passed. No dependency manifest or lockfile change was made by V3.

### Boundary Review

- No V3 import or write path reaches Tool Search, Code Mode, DCS, MCP
  materialization, Context storage, ArchiveHandle, Host API, Electron, Renderer,
  prompts, approval, retry, provider dispatch, or persistence.
- No feature flag, executor registration, lease, daemon, protocol, durable store,
  or user-visible catalog was added.
- Duplicate ids are excluded rather than owner-resolved; `dependsOn` remains a
  workflow relationship and does not grant execution authority.

### Decision

V3-00/V3-01 foundation implementation is accepted as a metadata-only shadow
package. It is not a production resolver, execution authority, default-on
feature, or V3-08 rollout decision.
V3-02 must not begin until this foundation's boundary and evidence are reviewed;
the unrelated strict-diff worktree changes must be resolved or explicitly
waived by the next acceptance owner.
