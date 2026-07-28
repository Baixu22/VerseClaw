# Remote Forge shared contracts

> Scope: `FP-P2-07` through `FP-P2-10`. This freezes compatibility policy, the bounded patch adapter, local consumers, the GitHub-only read control plane, approved review/comment/metadata mutations, and fail-closed controlled merge.

## Authority

`shared/types/remote-forge.ts` is the only shared source for:

- `GitPatchArtifact/v1`: a single changed-file observation used by local Git, Code Review, DCS edit/write, diff rendering, Agent artifacts, and later Remote Forge adapters;
- `RemoteForgeError/v1`: a safe, request-correlated Remote Forge error envelope.

Multi-file results use an ordered `GitPatchArtifactV1[]`. They must not introduce a bundle-specific file schema. The patch artifact is observation only: local Git remains owned by `electron/services/git-api.ts`, while mutation, snapshots, recovery, and undo remain owned by the Coding write journal.

## Compatibility rules

1. Writers emit the exact `schema` discriminator. Untagged payloads are invalid.
2. Readers accept known required fields plus additive unknown fields within `/v1`.
3. Unknown enum values and `/v2` or later schemas fail closed. A future incompatible change requires a new decoder and an explicit adapter; it must not be cast to v1.
4. `complete`, `truncated`, and `unavailable` are not interchangeable. Non-complete artifacts require a message. `unavailable` cannot carry hunks or a patch body.
5. `unknown` file status or content kind cannot be marked `complete`.
6. Every parsed hunk requires sequential old/new line ownership from its declared starts; complete text hunks additionally require exact old/new counts. Binary and metadata-only artifacts have no text hunks and carry an explanatory message.
7. Rename/copy records require distinct `oldPath` and `newPath` values. Paths are repository-relative POSIX paths at adapter boundaries: no POSIX-absolute or Windows drive paths, backslashes, empty segments, or `.`/`..` traversal segments.
8. `RemoteForgeError/v1.safeMessage` is a bounded single-line user-safe message, never a raw response body. Credential and private-host redaction remains mandatory in the producer layer.

## Legacy migration matrix

| Current producer/shape | v1 adapter rule | Fail-closed rule |
|---|---|---|
| `GitDiffResult` (`patch`, `original`, `modified`, `tooLarge`, `binary`) | Combine the result with trusted repository status, then parse or construct one artifact. Preserve `patch` as text fallback only when it is the complete producer output. | `tooLarge=true` becomes `unavailable`, never an empty complete diff. Missing trusted status becomes `status=unknown` and non-complete. |
| Code Review raw patch + `CodeReviewDiffStats.truncated` | Parse each file into an ordered artifact array; `truncated=true` remains `truncated` even when the visible prefix parses. | Parser failure or missing file boundaries becomes `unavailable`; zero findings do not imply patch completeness. |
| diff extension `DiffInput.kind=patch` | Adapt the parsed full input into v1 before rendering. The renderer consumes the artifact and may retain raw patch text as fallback. | Pierre parse success is not proof that a bounded prefix was complete; producer completeness wins. |
| DCS `edit` preview/unified patch | Build from the exact before/after content for the accepted mutation and attach the same request/mutation/journal lineage. Normalize CRLF into logical lines while keeping the copyable patch representation explicit. | Preview-only or mutation-mismatched data cannot be promoted to a successful mutation artifact. |
| DCS full-file `write` precheck (`different/same/unknown`) | Capture a journal-owned before snapshot and verified after content, then construct a real add/modify diff. | The existing precheck alone is not a diff. Until both sides are available, emit no artifact or an explicit `unavailable` artifact. |
| Remote Forge response | Main-owned adapter maps provider payloads and pagination state to ordered artifacts and `RemoteForgeError/v1`. | Pagination failure, response truncation, missing head SHA, stale state, or unknown provider fields cannot become complete/ready. |

## Edge-case policy for the parser slice

- CRLF: parse logical lines without retaining `\r` in line text; retain a deterministic text fallback.
- Bare or malformed hunks: return `unavailable` with a safe reason unless the adapter can prove ranges and line mapping.
- Binary: use `contentKind=binary`, no hunks, and an explicit message.
- Metadata-only: use `contentKind=metadata`, no fake text change.
- Truncated input: preserve any trustworthy parsed prefix but keep `completeness=truncated`; never repair it into `complete`.
- Empty input: absence is `unavailable`, not a complete empty artifact.

## Slice 3 adapter API and bounds

`shared/remote-forge/unified-diff-adapter.ts` provides the clean-room `adaptUnifiedDiffToGitPatchArtifacts` boundary. Its input requires the producer's `sourceCompleteness`; its only patch payload output is an ordered `GitPatchArtifactV1[]`. The small result discriminator distinguishes "file artifacts were recovered" from "no trustworthy file identity exists" and is not a second versioned patch/error schema.

Complete text blocks are grammar-checked with the existing `@pierre/diffs` parser before v1 mapping. The adapter separately maps exact old/new line ownership, rename/copy metadata, binary observations, and `\\ No newline at end of file`. Producer-declared truncated input bypasses any complete inference: only sequential, count-bounded prefix lines are retained and every recovered artifact remains `truncated`. A file-scoped malformed block becomes an `unavailable` v1 without patch/hunks; empty, unavailable, boundary-less, or globally over-limit input returns the result-level unavailable branch and cannot resemble an empty complete diff.

The shared parser ceiling is fixed and measured before parsing:

| limit | value | semantics |
|---|---:|---|
| UTF-8 input bytes | 1,048,576 | Over-limit input is unavailable; no prefix slicing inside the adapter |
| file blocks | 128 | Preserves input order; excess fails the whole adaptation closed |
| hunks | 4,096 | Counts declared hunk headers before mapping |
| logical lines | 120,000 | Applies after CRLF/lone-CR normalization to LF |

Existing producer limits remain valid when stricter: local Git's 180,000-character patch cap, Code Review's 120,000-character cap, and the diff extension's 128-file/120,000-line render cap are not silently raised. Slice 4 passes local Git `tooLarge` and Code Review `truncated` state into this adapter; parser success never upgrades producer completeness.

## Slice 4 consumer migration

- Local Git: `electron/services/git-api.ts` remains the sole local Git authority. It combines adapter output with trusted porcelain status; missing or mismatched status produces `status=unknown`, `completeness=unavailable`. Producer over-limit output never reaches the parser as a complete patch.
- Code Review: Main emits ordered `patchArtifacts` alongside its bounded raw text. A malformed/unavailable projection or producer-truncated patch blocks model review; zero findings cannot make incomplete evidence complete. Renderer copy is localized and does not choose transport or parse patches.
- DCS edit/journal: successful `edit` projects its exact accepted unified patch and tool-call request lineage. The existing write-journal wrapper adds the matching snapshot id. Invalid artifacts, request drift, or a file without the corresponding journal snapshot fail closed to an empty projection plus `patchArtifactError`.
- Packaging: Electron Main bundles the ESM-only `@pierre/diffs` parser and its unused-but-declared `shiki` import so production startup never relies on an invalid CommonJS `require()` or a pnpm-transitive runtime lookup.

The published diff extension remains inside its own package boundary. Its scoped `AGENTS.md` prohibits relative imports that escape the extension package; importing the ClawX root adapter would violate that boundary, while copying the parser or contract would violate the single-source rule. Slice 4 therefore records the boundary instead of creating a second adapter. The rendering integration must be resolved in slice 5 through an allowed shared/package surface together with rich diff fallback behavior.

## Slices 5-6 projection and error closure

- Journal-backed `edit` and full-file `write` results expose the same verified patch in rich and copyable text forms. Full-file writes derive their before side from the write journal and verify after bytes; Renderer state is never a mutation or recovery authority.
- Gateway and Renderer projections require complete patch artifacts with matching request, journal, and repository-relative path lineage. Missing, stale, malformed, unknown-schema, or truncated evidence remains unavailable.
- Every patch producer and consumer uses `RemoteForgeError/v1`. Error code determines the canonical safe message, retryability, and optional HTTP status. Producer text, credentials, headers, response bodies, repository content, private hosts, and absolute paths are discarded before the envelope crosses a boundary.

## FP-P2-08 GitHub read control plane

`electron/services/remote-forge-api.ts` is the Main-owned GitHub REST adapter. The Renderer reaches it only through the typed `remoteForge` host service, while the three read-only MCP tools reuse the same service instance. Neither path shells out to `git`/`gh`, selects a transport, accepts a caller-provided origin, or changes the authority of local Git and the Coding write journal.

`RemoteForgePullRequestRead/v1` groups PR detail, commits, file metadata, `GitPatchArtifact/v1` diffs, checks, reviews, branch protection, readiness, capability, aggregate completeness, and bounded request traces. Collections deduplicate stable provider ids, SHAs, or paths while retaining explicit `complete`, `incomplete`, `truncated`, and `unavailable` states. Repository visibility proves only the endpoints actually observed: uncalled or unverified permissions remain `unknown`, not `supported`.

Preview limits are fixed:

| limit | value |
|---|---:|
| provider page size | 100 items |
| pages / deduplicated collection | 5 / 500 items |
| response body | 1 MiB |
| request timeout | 5 seconds |
| requested content paths | 16 |
| concurrent content reads | 4 |
| decoded content per file | 512 KiB |

The full diff is fetched independently and projected only through `adaptUnifiedDiffToGitPatchArtifacts`. Missing patches, file/diff path drift, malformed diff, pagination failure, missing head SHA, unknown branch protection, invalid base64, unsafe paths, or any exceeded limit remains explicit incomplete evidence. Readiness is `ready`, `blocked`, `pending`, or `unknown`; any missing, failed, truncated, or unknown prerequisite forces `unknown` and cannot enable a remote action.

Content results distinguish UTF-8, binary, provider base64, truncated, and unavailable data. Request traces retain only request id, operation, method, bounded route template, status, duration, and completeness. The production origin is `https://api.github.com`; alternate origins exist only for injected tests or `VERSE_CLAW_E2E=1` fake-provider runs.

## FP-P2-09 approved mutation control plane

The existing Main-owned Remote Forge service now owns review submission, line-comment create/edit, thread reply, and allowlisted PR metadata updates through the typed host API. It reuses `permissions-api` as the single durable approval authority; Renderer code only holds drafts and never publishes directly.

Every normalized mutation binds provider, repository, pull request, expected head SHA, action, and a SHA-256 digest of its bounded canonical payload. Metadata also binds `expectedUpdatedAt`; line comments bind path, side, line, body digest, head lineage, and at most one bounded diff hunk. Full source files and comment bodies are excluded from retained snapshots and request traces.

The first invocation validates the payload and immediately reads the PR head/version, then returns an approval request without a remote write. An exact approved retry consumes that binding once before immediately re-reading head/version. Missing, denied, expired, consumed, action-drifted, payload-drifted, stale-head, or stale-version approval fails closed.

Mutation results separate the primary effect from label, reviewer, and refresh follow-ups. Primary success plus a follow-up failure is `partial`; an ambiguous write is `unknown` with manual reconciliation and never encourages a blind retry. Automated coverage uses only an injected or E2E loopback fake provider.

## FP-P2-10 controlled merge policy

The same Main-owned service owns merge preview and execution. Each request binds provider, repository, pull request, expected head SHA, merge strategy, readiness digest, sandbox-policy digest, and payload digest. Approval expires after five minutes, is consumed once, and cannot be reused after any bound value changes.

Before requesting approval and again immediately before the provider write, Main re-reads the pull request and every readiness input. Missing or stale head, incomplete pagination, unknown protection or capability, draft, conflicts, pending or failed checks, insufficient review, unresolved discussion, or policy denial is a hard veto. Renderer preflight is informational only and cannot authorize execution.

Provider merge uses the expected head SHA. Production policy has an empty sandbox repository allowlist and Agent-initiated merge is disabled. Only `VERSE_CLAW_E2E=1` may inject a fixture allowlist. MCP calls the same service with `initiator=agent`; it may request approval or retry with an externally granted approval, but cannot decide approval or bypass the default-off policy.

The primary merge effect, post-merge refresh, and audit follow-up are distinct effects. A successful merge followed by refresh or audit failure returns partial reconciliation and never invites a blind merge retry. Conflict or stale-head responses require a refresh; ambiguous provider writes require manual reconciliation.

## Current boundary

`FP-P2-07` through `FP-P2-10` are engineering-complete. No production repository is allowlisted and no real remote effect is authorized before the `FP-P2-01/02` human charter and run gates.

User-visible patch and Remote PR behavior is synchronized across README.md, README.zh-CN.md, README.ja-JP.md and en/zh/ja/ru UI copy.
