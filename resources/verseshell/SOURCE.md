# VerseShell Source and Build Instructions

The bundled Windows x64 `ae.exe` is built from one pinned upstream commit plus the tracked UAS-05
corresponding-source patch recorded in `manifest.json`:

- Source repository: `https://github.com/Baixu22/VerseShell.git`
- Pinned commit: `c3983694407a9ddb23505e05fad4a9eae653b283`
- Source patch: `resources/verseshell/patches/uas-05-process-lifecycle.patch`
- Patch SHA-256: `cabfb192f6f9688156f5a3ab5a19307fcd1af3fb2ee2c59b2d494a557d417098`
- Binary SHA-256: `19ca598916077f677722b4f82d8dfc1c24c4e88ace9809abe681255370702699`
- Binary size: `14880256` bytes

The patch is part of the corresponding source. The pinned commit alone does not reproduce this
binary and must not be presented as a clean-build identity.

## Obtain the corresponding source

Clone the repository, check out the exact base commit, and apply the tracked patch from the ClawX
source tree:

```text
git clone https://github.com/Baixu22/VerseShell.git verseshell
git -C verseshell checkout c3983694407a9ddb23505e05fad4a9eae653b283
git -C verseshell apply C:\path\to\ClawX\resources\verseshell\patches\uas-05-process-lifecycle.patch
git -C verseshell status --porcelain=v1
```

The final status must identify the same 13 tracked/untracked inputs recorded under
`provenance.build_input.status_porcelain`. Re-capture the patch if any source input changes; never
reuse the recorded patch or binary hash for a different worktree.

## Rebuild and synchronize

First capture the complete tracked diff plus untracked source files:

```text
node scripts/verseshell-bundle.mjs capture-patch --source C:\path\to\verseshell --output resources/verseshell/patches/uas-05-process-lifecycle.patch
```

Then run the package synchronization command described in `BUILD.md`, including
`--allow-dirty-provenance`, `--source-patch`, `--source-snapshot`, and `--patch-instructions`.
The synchronization command builds `cargo build --release --bin ae`, copies only `ae.exe`, and
updates the manifest after validating that the patch SHA-256 equals the recorded build-input digest.

The source repository, patch, this notice, the AGPL license text, and the build instructions must
remain available to recipients as required by AGPL-3.0-or-later.
