# VToken sidecar

VToken is a Python 3.12 project built with `uv`. It is intentionally kept under
`packages/` even though it is not a pnpm workspace package.

- Python project metadata: `pyproject.toml`
- Locked environment: `uv.lock`
- Electron packaging source: `electron-builder.yml` copies `packages/vtoken/src`
  to `resources/vtoken/src`
- Runtime boundary: the Host/Main process launches the sidecar; the renderer
  does not import it directly

Changing this location requires updating the packaging mapping, the launcher,
the source-retention policy and the runtime startup tests in the same change.
