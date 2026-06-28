# Lane A: Command Contract And Help

## Verdict

accepted

## Evidence

- `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs` exposes `--help` with readonly/default-off wording.
- Help names explicit `--persist`, explicit `--read-shadow`, explicit `--database <path>`, diagnostics-only output, no durable fact authority, no runtime authority, and no Gateway/Electron/renderer/provider/TaskLoop/prompt/service/listener/daemon integration.
- `tests/unit/runtime-memory-read-hydration-shadow-command.test.ts` asserts the help contract.

## Boundary Checks

No product runtime path is introduced by help/argument parsing.

## Gaps

None.
