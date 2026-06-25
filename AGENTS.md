# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Verse Claw is a cross-platform **Electron desktop app** (React 19 + Vite + TypeScript) providing a GUI for the OpenClaw AI agent runtime. It uses pnpm as its package manager (pinned version in `package.json`'s `packageManager` field).

### Agent Harness routing

`AGENTS.md` is the lightweight cross-tool entry point. Durable AI coding policy lives under `harness/specs/**`:

- `rules/` holds hard rules that should be validated when practical.
- `scenarios/` describes user-visible or cross-layer flows.
- `tasks/` describes concrete work specs with required rules, tests, and acceptance criteria.
- `guides/` holds thinking/workflow guidance that is not a hard rule.
- `layers/` holds subsystem conventions selected by touched paths.

For task-spec work, run `pnpm harness context --spec <task-spec>` before implementation to get the smallest relevant reading list. Do not introduce a parallel `.trellis/`-style source of truth; promote reusable lessons into `harness/specs/**`.

### Quick reference

Standard dev commands are in `package.json` scripts and `README.md`. Key ones:

| Task | Command |
|------|---------|
| Install deps + download uv | `pnpm run init` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| Comms replay metrics | `pnpm run comms:replay` |
| Comms baseline refresh | `pnpm run comms:baseline` |
| Comms regression compare | `pnpm run comms:compare` |
| E2E tests (Playwright) | `pnpm run test:e2e` |
| Build frontend only | `pnpm run build:vite` |

### Non-obvious caveats

- **pnpm version**: The exact pnpm version is pinned via `packageManager` in `package.json`. Use `corepack enable && corepack prepare` to activate the correct version before installing.
- **Electron on headless Linux**: The dbus errors (`Failed to connect to the bus`) are expected and harmless in a headless/cloud environment. The app still runs fine with `$DISPLAY` set (e.g., `:1` via Xvfb/VNC).
- **`pnpm run lint` race condition**: If `pnpm run uv:download` was recently run, ESLint may fail with `ENOENT: no such file or directory, scandir '/workspace/temp_uv_extract'` because the temp directory was created and removed during download. Simply re-run lint after the download script finishes.
- **Build scripts warning**: `pnpm install` may warn about ignored build scripts for `@discordjs/opus` and `koffi`. These are optional messaging-channel dependencies and the warnings are safe to ignore.
- **`pnpm run init`**: This is a convenience script that runs `pnpm install` followed by `pnpm run uv:download`. Either run `pnpm run init` or run the two steps separately.
- **Gateway startup**: When running `pnpm dev`, the OpenClaw Gateway process starts automatically on port 18789. It takes ~10-30 seconds to become ready. Gateway readiness is not required for UI development—the app functions without it (shows "connecting" state).
- **No database**: The app uses `electron-store` (JSON files) and OS keychain. No database setup is needed.
- **AI Provider keys**: Actual AI chat requires at least one provider API key configured via Settings > AI Providers. The app is fully navigable and testable without keys.
- **Token usage history implementation**: Dashboard token usage history is not parsed from console logs. It reads OpenClaw session transcript `.jsonl` files under the local OpenClaw config directory, scans both configured agents and any runtime agent directories found on disk, and treats normal, `.deleted.jsonl`, and `.jsonl.reset.*` transcripts as valid history sources. It extracts assistant/tool usage records with `message.usage` and aggregates fields such as input/output/cache/total tokens and cost from those structured records. Note: "Delete conversation" in the sidebar is a hard delete — the Main process unlinks `<id>.jsonl` plus any leftover `<id>.deleted.jsonl` and `<id>.jsonl.reset.*` siblings, *and* OpenClaw's trajectory artefacts (`<id>.trajectory.jsonl` flight recorder + `<id>.trajectory-path.json` pointer); when the pointer references a runtime file outside the agent's `sessions/` folder (the `OPENCLAW_TRAJECTORY_DIR` override), that off-disk file is unlinked too. Deleted conversations stop contributing to this chart — use a fresh session if you want history retained.
- **Models page aggregation**: The 7-day/30-day filters are relative rolling windows, not calendar-month buckets. When grouped by time, the chart should keep all day buckets in the selected window; only model grouping is intentionally capped to the top entries.
- **OpenClaw Doctor in UI**: In Settings > Advanced > Developer, the app exposes both `Run Doctor` (`openclaw doctor --json`) and `Run Doctor Fix` (`openclaw doctor --fix --yes --non-interactive`) through the host-api. Renderer code should call the host route, not spawn CLI processes directly.
- **UI change validation**: Any user-visible UI change should include or update an Electron E2E spec in the same PR so the interaction is covered by Playwright.
- **i18n & styling conventions**: New user-facing features must (1) route all text through `react-i18next` with full locale coverage (`en` / `zh` / `ja` / `ru` under `shared/i18n/locales/<lang>/<ns>.json`) — never hardcode display strings, and (2) use the design tokens and substitution rules documented in `src/styles/globals.css` (surfaces `bg-surface-modal` / `bg-surface-input`, selected state `bg-black/5 dark:bg-white/10`, status colours `text-X-700 dark:text-X-400`, page H1/H2 `font-serif font-normal tracking-tight`, etc.) — see the *Component conventions* block in `globals.css` for the full substitution table.
- **Renderer/Main API boundary (important)**:
  - Renderer must use `src/lib/host-api.ts` and `src/lib/api-client.ts` as the single entry for backend calls.
  - Do not add new direct `window.electron.ipcRenderer.invoke(...)` calls in pages/components; expose them through host-api/api-client instead.
  - Do not call Gateway HTTP endpoints directly from renderer (`fetch('http://127.0.0.1:18789/...')` etc.). Use Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`) to avoid CORS/env drift.
  - Transport policy is Main-owned and fixed as `WS -> HTTP -> IPC fallback`; renderer should not implement protocol switching UI/business logic.
- **Comms-change checklist**: If your change touches communication paths (gateway events, runtime send/receive, delivery, or fallback), run `pnpm run comms:replay` and `pnpm run comms:compare` before pushing.
- **Doc sync rule**: After any functional or architecture change, review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates; if behavior/flows/interfaces changed, update docs in the same PR/commit.
- **Spec-driven harness rule**: AI Coding tasks that touch backend communication must start from a task spec under `harness/specs/tasks/` and reference `gateway-backend-communication` when the change involves renderer/Main/host-api/api-client/Gateway/OpenClaw runtime paths. Run `pnpm harness validate --spec <task-spec>` before implementation review, and `pnpm harness run --spec <task-spec>` or `--dry-run` when checking the selected validation flow.
- **Spec/rule growth rule**: When adding a new feature, user-visible OpenClaw scenario, or recurring AI Coding constraint, add or update the relevant harness scenario spec and rule spec in the same PR so future AI work can validate the behavior instead of relying on tribal knowledge.
- **Harness CI/local parity**: Run `pnpm run harness:ci` to exercise the same baseline harness checks used by GitHub Actions. Real task specs should be validated without `--no-diff`; `--no-diff` is only for structural checks of checked-in examples.
### Bash Shell MCP Server

该项目注册了一个 `bash-shell` MCP server（通过 Git Bash 执行），暴露 `bash_command` 工具。
当需要运行 shell 命令时，优先使用 `bash_command` 工具而非 `shell_command`（PowerShell），
因为 `shell_command` 在 Windows 上默认使用 PowerShell。

MCP server 脚本路径：
`.codex-tools/bash-mcp-server/scripts/bash-mcp-server.mjs`

如需在 Codex 重启后重新注册，运行：
```powershell
& "$env:LOCALAPPDATA\OpenAI\Codex\bin\8e55c2dd143b6354\codex.exe" mcp add bash-shell -- node "C:\Users\27933\Desktop\Verse Claw\verse-claw\.codex-tools\bash-mcp-server\scripts\bash-mcp-server.mjs"
```
或运行安装脚本：
```powershell
.codex-tools\bash-mcp-server\install-mcp.ps1
```

## Shell Strategy (Git Bash as POSIX shell)

### PATH 配置
- Git Bash: C:\Program Files\Git\bin
- Node.js: C:\Program Files\nodejs
已在 User PATH 中持久化。

### 执行策略（重要）

PowerShell 的 ash 命令默认解析到 WSL（C:\Windows\system32\bash.exe），
而非 Git Bash。使用 Git Bash 必须指定完整路径。

| 场景 | 命令模式 |
|------|----------|
| POSIX 引号命令 | ` & \"C:\Program Files\Git\bin\bash.exe\" --% -c 'node -e \"...\"' ` |
| Electron 构建/E2E | 直接使用 pnpm run build:vite 或 powershell.exe -Command "..." |
| 复杂多行脚本 | 写入临时文件再执行 |
| 单元测试 (vitest) | WSL Node 或 Windows Node 均可 |

### E2E 测试注意点

E2E 测试需要 Electron（Win32 进程），必须从 Windows 环境执行：
- 构建：pnpm run build:vite（同时构建前端 + Electron）
- 测试：pnpm run test:e2e tests/e2e/<spec>.ts
- 测试文件支持在 WSL 中编写（POSIX 引号），在 Windows 中执行
