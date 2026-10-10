# Packages

This directory contains components that are packaged by Verse Claw but are not
all JavaScript packages in the pnpm workspace.

| Package | Language | Workspace membership |
| --- | --- | --- |
| `vtoken` | Python / uv | Deliberately outside `pnpm-workspace.yaml`; launched as a sidecar |
| Shared JavaScript packages | TypeScript | Declared by the nearest `package.json` and `pnpm-workspace.yaml` where applicable |

The repository root and `resources/verseshell-mcp` are the JavaScript pnpm
workspace packages. `packages/vtoken` is copied into the Electron application
through `electron-builder.yml` and must not be treated as a pnpm dependency.
