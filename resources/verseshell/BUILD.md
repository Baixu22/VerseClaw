# Building the bundled VerseShell runtime

The only accepted product artifact is a Windows x64 `ae.exe` produced by two independent clean
reconstructions described by `SOURCE.md` and `source-inputs.json`.

## Fixed build contract

- Target: `x86_64-pc-windows-msvc`
- Crate: `verseshell` `1.0.0`; packaged binary: `ae.exe` only
- Cargo/rustc: `1.94.0`
- Cargo command: `cargo build --locked --release --bin ae`
- `CARGO_INCREMENTAL=0`, `SOURCE_DATE_EPOCH=1785123525`
- Rust source/target roots are remapped to stable `/verseshell/source` and `/verseshell/target`
- MSVC linker uses `/Brepro` and the recorded PDB path control

## Rebuild and synchronize

Run this from the ClawX repository root on the supported Windows host:

```text
node scripts/verseshell-bundle.mjs rebuild --platform win32 --arch x64 --mode package
```

The script creates a fresh detached worktree for qualification and two more independent worktrees
and target directories for release builds. It applies every tracked patch in order, checks the
allowlisted ignored inputs and final assertions, runs complete locked Rust tests plus `--no-run`,
and runs the optional Python fixtures through the current interpreter as `python -m pytest -q`.
Each release binary must pass the typed `runtime.handshake` and catalog checks. The two binaries
must have identical byte length and SHA-256 before the existing binary or manifest is replaced.

The replacement is atomic and fail-closed. A legacy ignored `resources/bin/win32-x64/ae.exe` is
never copied as input or used as evidence; it can only be replaced by the newly qualified output.

## Validation and packaging

```text
node --test scripts/verseshell-bundle.test.mjs
node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode package
node scripts/verseshell-bundle.mjs verify-package --resources release\win-unpacked\resources --platform win32 --arch x64
```

Package validation requires the binary, v2 manifest, source-input manifest, all four patches,
official AGPL text, notice, source instructions, and build instructions. It verifies source digest
and identity, patch order/size/hash, recovered-input inventory, Rust/Python qualification proof,
reproducibility proof, handshake/catalog identity, exact artifact size, and binary SHA-256.
