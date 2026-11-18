# VerseShell Corresponding Source

The Windows x64 runtime is reproducible from the exact upstream commit plus the ordered, tracked
patch stack in `source-inputs.json`. The pinned commit by itself is not the shipped source identity.

- Repository: `https://github.com/Baixu22/VerseShell.git`
- Commit: `c06f406e83566bb968448222d9c8caf429e580a0`
- Commit epoch: `1791974123`
- Source identity: `sha256:a9eb8940dd4f6509fdec8abebfc6351933266494387b3ae1e7e5e0445a00e0d5`
- Patch stack: three entries, applied in manifest order with `git apply`
- Recovered ignored inputs: none; the pinned commit tracks every referenced Python input

`source-inputs.json` records every patch path, byte count, SHA-256, recovered input, final source
assertion, test command, toolchain, and reproducibility control. A validator must reject missing,
reordered, modified, undeclared, or generated inputs before a build is accepted.

## Reconstruct the source

From the ClawX repository root, use the bundle script so the clean detached reconstruction and all
source assertions are checked consistently:

```text
node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode package
```

For an explicit source checkout, clone the repository, check out the pinned commit, then apply all
declared patches in `source-inputs.json` in ascending `order` with `git apply --check` followed by
`git apply`. Do not copy an ignored `ae.exe`, `target`, `.ae`, Python cache, log, PDB, or result file
into the corresponding source.

## License and corresponding-source delivery

Keep this file, `BUILD.md`, `NOTICE.md`, the official AGPL-3.0-or-later text, `source-inputs.json`,
and every declared patch alongside the packaged runtime. The manifest locator binds the repository,
commit, source-input digest, and combined source identity into one corresponding-source record.
