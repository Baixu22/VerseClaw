# Building the bundled VerseShell runtime

These instructions supplement `SOURCE.md`; they do not replace its corresponding-source
requirements.

## Supported product target

- Platform: Windows (`win32`)
- Architecture: x64
- Rust package: `verseshell` version `1.0.0`
- Minimum declared Rust version: `1.75`
- Shipped binary: `ae.exe` only (`ae-mcp.exe`, PDB files, and dependency output are not copied)

## Build and synchronize the UAS-05 source

From the ClawX repository root, with Cargo and rustc available for the
`x86_64-pc-windows-msvc` host, first capture the complete source delta:

```text
node scripts/verseshell-bundle.mjs capture-patch --source C:\path\to\verseshell --output resources/verseshell/patches/uas-05-process-lifecycle.patch
```

Then synchronize the authorized dirty base-plus-patch build:

```text
node scripts/verseshell-bundle.mjs sync --source C:\path\to\verseshell --platform win32 --arch x64 --mode package --allow-dirty-provenance --source-patch resources/verseshell/patches/uas-05-process-lifecycle.patch --source-snapshot https://github.com/Baixu22/VerseShell.git@c3983694407a9ddb23505e05fad4a9eae653b283+resources/verseshell/patches/uas-05-process-lifecycle.patch --patch-instructions "Clone the recorded repository, checkout c3983694407a9ddb23505e05fad4a9eae653b283, then apply resources/verseshell/patches/uas-05-process-lifecycle.patch from the ClawX source tree with git apply."
```

The script runs exactly:

```text
cargo build --release --bin ae
```

It atomically copies `target/release/ae.exe` to `resources/bin/win32-x64/ae.exe` and records the
source status, complete patch digest, Cargo metadata, toolchain identity, exact byte length, binary
SHA-256, protocol, and operation catalog. Package mode fails unless the patch exists, its digest
matches `provenance.build_input.diff_sha256`, and the explicit dirty-source approval metadata points
to the same corresponding source.

## Validation

Validate source resources without rebuilding:

```text
node --test scripts/verseshell-bundle.test.mjs
node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode package
```

Validate an unpacked Electron application's resource directory:

```text
node scripts/verseshell-bundle.mjs verify-package --resources release\win-unpacked\resources --platform win32 --arch x64
```

Both validators require the binary, manifest, official AGPL license text, notice, source
instructions, build file, and UAS-05 patch. They verify target identity, protocol/catalog metadata,
exact size, binary SHA-256, patch SHA-256, and corresponding-source approval.
