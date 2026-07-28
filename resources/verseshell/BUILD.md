# Building the bundled VerseShell runtime

These instructions supplement `SOURCE.md`; they do not replace its corresponding-source requirements.

## Supported initial product target

- Platform: Windows (`win32`)
- Architecture: x64
- Rust package: `verseshell` version `1.0.0`
- Minimum declared Rust version: `1.75`
- Shipped binary: `ae.exe` only (`ae-mcp.exe`, PDB files, and dependency output are not copied)

## Build and synchronize

From the ClawX repository root, with Cargo and rustc available for the `x86_64-pc-windows-msvc` host:

```text
node scripts/verseshell-bundle.mjs sync --source C:\path\to\verseshell --platform win32 --arch x64 --mode dev
```

The script runs exactly:

```text
cargo build --release --bin ae
```

It then copies `target/release/ae.exe` through a temporary file and atomic rename to `resources/bin/win32-x64/ae.exe`, computes its exact byte length and SHA-256, and updates `manifest.json` with Cargo, rustc, target, Git remote/commit/dirty state, status entries, and a digest of the tracked source diff.

## Dirty source and package mode

Package mode refuses a dirty source checkout by default. If an authorized build must include local modifications, first preserve complete corresponding source (including untracked source inputs) or a stable source snapshot plus all patches, then invoke:

```text
node scripts/verseshell-bundle.mjs sync --source C:\path\to\verseshell --platform win32 --arch x64 --mode package --allow-dirty-provenance --source-snapshot <stable-locator> --patch-instructions <how-to-obtain-and-apply-all-local-changes>
```

The override is provenance metadata, not permission to omit source. Package validation fails unless a dirty build records both the corresponding-source locator and patch/source-snapshot instructions. An upstream commit alone never identifies a dirty binary.

## Validation

Validate source resources without rebuilding:

```text
node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode package
```

Validate an unpacked Electron application's resource directory:

```text
node scripts/verseshell-bundle.mjs verify-package --resources release\win-unpacked\resources --platform win32 --arch x64
```

Both validators require the binary, manifest, official AGPL license text, notice, source instructions, and this build file; they verify target, protocol metadata, exact size, SHA-256, and corresponding-source provenance.
