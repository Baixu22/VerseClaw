# Lane B: Asar And ExtraResources No Invocation

## Verdict

accepted

## Evidence

- Read `electron-builder.yml`, `scripts/after-pack.cjs`, `scripts/run-electron-builder.mjs`, and `scripts/bundle-openclaw-runtime.mjs`.
- `asar` is enabled and `asarUnpack` is limited to native/module compatibility entries, not hydration helper files.
- `extraResources` may include `build/openclaw-runtime/`, and afterPack may copy `openclaw-runtime/node_modules`, but release hooks do not execute hydration and do not pass `--persist`, `--read-shadow`, `--database`, or `--db`.

## Boundary Checks

No afterPack, electron-builder, run-electron-builder, bundle script, service/listener, SQLite, Gateway, Electron IPC, renderer, host-api/api-client, provider, TaskLoop, prompt/model, durable fact authority, or runtime authority surface changed.

## Gaps

None.
