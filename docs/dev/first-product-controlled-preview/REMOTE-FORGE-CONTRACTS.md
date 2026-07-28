# Remote Forge shared patch/error contracts

> Scope: `FP-P2-07` slice 2. This freezes compatibility policy only; no consumer migration, UI behavior, remote read, or remote mutation is enabled by this document.

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

## Slice boundary

Slice 2 adds the versioned contracts, strict decoders, compatibility policy, and focused tests. Parser/adapter implementation is slice 3; Git/Code Review/DCS consumer migration is slice 4; edit/write rich diff and text fallback behavior is slice 5; producer error redaction and negative tests are slice 6.

No README translation update is required for slice 2 because it changes no user-visible behavior or public workflow.
