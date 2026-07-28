# VerseShell Source and Build Instructions

The bundled Windows x64 `ae.exe` is built from the clean VerseShell source commit recorded in `manifest.json`:

- Source repository: `https://github.com/Baixu22/VerseShell.git`
- Pinned commit: `c3983694407a9ddb23505e05fad4a9eae653b283`
- Corresponding-source locator: `https://github.com/Baixu22/VerseShell.git@c3983694407a9ddb23505e05fad4a9eae653b283`

The manifest records the source checkout status, empty Git-diff digest, Cargo metadata, Rust toolchain details, and exact binary SHA-256. Do not substitute a different checkout or modify the source tree and retain this provenance claim.

## Obtain the corresponding source

Clone the recorded repository and checkout the exact commit:

```text
git clone https://github.com/Baixu22/VerseShell.git verseshell
git -C verseshell checkout c3983694407a9ddb23505e05fad4a9eae653b283
git -C verseshell status --porcelain=v1
```

The final command must produce no output for the clean-bundle provenance recorded here. The source repository, this notice, the AGPL license text, and the build instructions must remain available to recipients as required by AGPL-3.0-or-later.

## Rebuild

Use Rust 1.75 or a compatible newer toolchain, then run from the ClawX root:

```text
node scripts/verseshell-bundle.mjs sync --source C:\path\to\verseshell --platform win32 --arch x64 --mode package
```

The script runs `cargo build --release --bin ae`, atomically copies `target/release/ae.exe` to `resources/bin/win32-x64/ae.exe`, and updates the manifest only after validating the clean source provenance and binary hash.

## Dirty source is not releasable through this record

Package mode rejects a dirty source checkout by default. An authorized dirty build requires a complete corresponding-source snapshot plus patch instructions through the explicit `--allow-dirty-provenance`, `--source-snapshot`, and `--patch-instructions` path. It must not reuse this clean commit's manifest, checksum, or corresponding-source locator.