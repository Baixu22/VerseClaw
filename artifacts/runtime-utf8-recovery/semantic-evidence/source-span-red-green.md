# Source-Span RED/GREEN Evidence

## RED 1: Missing Variable-Length Aligner

Command:

```text
node --test artifacts/runtime-utf8-recovery/semantic-evidence/source-span-evidence.test.mjs
```

Exit: `1`

Expected failure: `ERR_MODULE_NOT_FOUND` for
`source-span-evidence.mjs`. The tests existed before the source-span aligner.

## GREEN 1: Source-Span Alignment

Command:

```text
node --test artifacts/runtime-utf8-recovery/semantic-evidence/source-span-evidence.test.mjs
```

Exit: `0`

Result: `5/5` tests passed for swallowed delimiters, multiple variable-length
spans, complete variation-selector/ZWJ tails, prefix/suffix mismatch rejection,
and ambiguous internal-segment rejection.

## RED 2: Missing Scanner-Unit Coalescing

Command:

```text
node --test artifacts/runtime-utf8-recovery/semantic-evidence/source-span-evidence.test.mjs
```

Exit: `1`

Expected failure: the module did not export `coalesceNearbyRanges`.

## GREEN 2: Coalesced Source Spans

Command: same focused Node test command.

Exit: `0`

Result: `6/6` tests passed. Adjacent or closely separated scanner units are
represented by one source-aligned repair span with all covered inventory IDs.

## RED 3: Missing Stable-Line Mapping

Command: same focused Node test command.

Exit: `1`

Expected failure: the module did not export `mapLinesByStableAnchors`.

## GREEN 3: Stable-Line Mapping

Command: same focused Node test command.

Exit: `0`

Result: `8/8` tests passed. Equal-length intervals bounded by exact LCS line
anchors are position-mapped; intervals containing source-only lines remain
unmapped.

## RED 4: Missing Comment Signature Corroboration

Command: same focused Node test command.

Exit: `1`

Expected failure: the module did not export
`corroborateCommentBySignature`.

## GREEN 4: Restricted Signature Corroboration

Command: same focused Node test command.

Exit: `0`

Result: `10/10` tests passed. Cross-file corruption signatures may corroborate
only comment-line candidates, require at least 20 independently sourced
support records, and cannot upgrade behavior-sensitive values.

## Full Evidence Generation

Command: `node source-span-evidence.mjs` with explicit repository, two upstream
snapshot roots, local history Git directory, anchored report, and local
evidence report arguments.

Exit: `0`

```text
records=1571 exact=0 corroborated=1571 candidate=0 conflict=0 unresolved=0
```
