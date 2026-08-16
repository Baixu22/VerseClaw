# VerseShell P0-02 Reproducible Bundle Evidence

Date: 2026-08-14  
Scope: `VS-P0-02` / Task Forest `TF-0059`  
Status: engineering qualification for source/build identity; not governed-probe, canary, GA, or product-approval evidence.  
Rollout decision: `default-off`; `liveReady=false`; `productApproved=false`; `defaultOn=false`.

## Source identity

The accepted corresponding source is the exact HTTPS repository commit followed by four tracked
patches in the order recorded by `resources/verseshell/source-inputs.json`:

| Item | Value |
|---|---|
| Repository | `https://github.com/Baixu22/VerseShell.git` |
| Commit / epoch | `c3983694407a9ddb23505e05fad4a9eae653b283` / `1785123525` |
| Patch count | 4 |
| Recovered ignored inputs | 8 allowlisted Python files |
| Source-input SHA-256 | `158d0ca4d2ec51080b2aa0bdeb6274755c7009af9a904f86eacf624993dcd489` |
| Combined source identity | `19008cf2844aac688cfc74276db3babf64d416d2c3ba9497cda632cfff75d650` |

The patch stack is UAS-05 process lifecycle, P0 startup repair, recovered ACI-Bench source inputs,
and the current-interpreter Python verifier contract. Every patch is checked by path, byte size,
SHA-256, and ordered `git apply --check`; final source assertions and the ignored-input allowlist
are checked before Cargo runs. Generated caches, targets, binaries, PDBs, logs, and result stores
are forbidden inputs.

## Qualification result

The bundle script reconstructs one clean source for qualification and two independent clean source
and target roots for release builds. It uses Cargo/rustc `1.94.0`, `--locked`, one Rust test job,
`CARGO_INCREMENTAL=0`, `SOURCE_DATE_EPOCH=1785123525`, stable source/target remapping, and MSVC
`/Brepro` controls. Both release outputs pass the typed `runtime.handshake` and operation catalog
checks before byte comparison.

| Gate | Result |
|---|---|
| Full locked Rust tests | PASS, including `aci_bench_mock_meets_acceptance_gate` |
| Rust `--no-run` compilation | PASS |
| Python optional verifier | PASS, 2/2 via current interpreter `python -m pytest -q` |
| Build roots | 2 independent source roots and 2 independent target roots |
| Reproducibility | PASS; byte-identical SHA-256 outputs |
| Binary | `14,879,232` bytes; SHA-256 `ac6a7a15dac0a9dc7d15ec975fc65276f25c871bbc0174197731947df6460786` |
| Handshake/catalog | `1.0.0`, `verseshell.jsonl/v1`, 31 operations, catalog digest `sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7` |

The manifest is replaced only after all gates pass, and package validation rechecks the source-input
digest, combined identity, patch inventory, qualification proof, reproducibility proof, binary
digest, handshake, catalog, AGPL compliance files, and corresponding-source paths. The previous
ignored `resources/bin/win32-x64/ae.exe` is never a build input or proof.

## Focused regression coverage

`node --test scripts/verseshell-bundle.test.mjs` passes 13/13. The negative cases fail closed for
patch reorder, patch size drift, package source-input digest drift, undeclared ignored input,
non-identical build proof, and missing required final source assertion. Runtime bundle, manifest,
and UAS-05 lifecycle focused tests pass 22/22.

## Repository gates

| Gate | Result | Note |
|---|---|---|
| `pnpm verseshell:test` | PASS | Bundle 13/13, runtime bundle 11/11, OpenClaw VerseShell 57/57 |
| `pnpm run typecheck` | PASS | Node/web projects pass; legacy test project remains observation-only |
| `pnpm run comms:replay` then `pnpm run comms:compare` | PASS | Candidate identity matches current tree; all replay/compare rows pass |
| `git diff --check` | PASS | No whitespace errors; Git only reports normal LF/CRLF conversion warnings |
| `pnpm harness context --spec ...` | PASS | Scoped read list resolved |
| `pnpm harness validate --spec ... --no-diff` | PASS | Spec structure and required profiles/rules validated |
| `pnpm harness validate --spec ...` | BLOCKED | Shared worktree contains unrelated changed paths outside this spec's ownership |
| `pnpm run harness:ci` | BLOCKED | Same shared-worktree ownership veto; the harness package also lacks local `node_modules` for its dry-run child |

The Harness failures are recorded as environment/ownership residuals, not bypassed. The strict
source, package, runtime, typecheck, communication, and focused regression gates remain green.

## Honest residuals

This evidence establishes the Windows x64 source/build/protocol identity only. It does not prove
approval denial/retry behavior, process lifecycle graduation, facade or MCP rollout, real provider
usage, canary safety, default-on eligibility, or product approval. Those remain locked behind the
serial Task Forest chain and the authoritative `STATUS.md` flags above.
