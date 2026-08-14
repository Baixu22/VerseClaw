# Core Tool Catalog (generated)

<!-- GENERATED FILE — DO NOT EDIT.
Source of truth: openclaw_runtime/src/agents/tool-catalog.ts
Regenerate: pnpm catalogs:gen   |   Check freshness: pnpm catalogs:check
Generated at: 2026-08-14T12:28:25.633Z
-->

Built-in core tool sections with their profiles. This file is generated —
edit the source of truth instead, then run pnpm catalogs:gen.

## Files (`fs`)

- `read` — Read file contents — profiles: `coding`
- `ls` — List directory contents — profiles: `coding`
- `write` — Create or overwrite files — profiles: `coding`
- `edit` — Make precise edits — profiles: `coding`
- `apply_patch` — Patch files — profiles: `coding`

## Runtime (`runtime`)

- `exec` — Run shell now. — profiles: `coding`
- `process` — Inspect/control exec sessions. — profiles: `coding`
- `code_execution` — Run sandboxed remote analysis — profiles: `coding`

## Web (`web`)

- `web_search` — Search the web — profiles: `coding`
- `web_fetch` — Fetch web content — profiles: `coding`
- `x_search` — Search X posts — profiles: `coding`

## Memory (`memory`)

- `memory_search` — Semantic search — profiles: `coding`
- `memory_get` — Read memory files — profiles: `coding`
- `context_read` — Read full context blocks on demand — profiles: `coding`
- `context_search` — Search context blocks by entity/query — profiles: `coding`
- `context_write` — Update agent notes context block — profiles: `coding`
- `context_understand` — Build a ContextPack for a coding goal — profiles: `coding`
- `context_impact` — Analyze callers/callees and blast radius — profiles: `coding`
- `context_reuse` — Find existing helpers before writing new code — profiles: `coding`
- `context_verify` — Review a diff for related tests and blast radius — profiles: `coding`

## Sessions (`sessions`)

- `sessions_compact` — Compact the current session after this turn — profiles: `coding`, `messaging`
- `sessions_list` — List visible sessions; filters/previews. — profiles: `coding`, `messaging`
- `sessions_history` — Read sanitized session history. — profiles: `coding`, `messaging`
- `sessions_send` — Message session or configured agent. — profiles: `coding`, `messaging`
- `task_loop` — Run a bounded self-checking task loop. — profiles: `coding`
- `mission_loop` — Run checkpointed long-goal Mission Loop. — profiles: `coding`
- `team_orchestrate` — Plan and spawn a role-first subagent team. — profiles: `coding`
- `sessions_spawn` — Spawn subagent or ACP session. — profiles: `coding`
- `sessions_yield` — End turn to receive sub-agent results — profiles: `coding`
- `subagents` — Manage sub-agents — profiles: `coding`
- `session_status` — Show session status/model/usage. — profiles: `minimal`, `coding`, `messaging`

## UI (`ui`)

- `browser` — Control web browser — profiles: —
- `canvas` — Control node Canvas surfaces when the Canvas plugin is enabled — profiles: —

## Messaging (`messaging`)

- `message` — Send messages — profiles: `messaging`

## Automation (`automation`)

- `heartbeat_respond` — Record heartbeat outcomes — profiles: —
- `cron` — Schedule reminders, cron, wake events. — profiles: `coding`
- `gateway` — Gateway control — profiles: —

## Nodes (`nodes`)

- `nodes` — Nodes + devices — profiles: —

## Agents (`agents`)

- `agents_list` — List agents — profiles: —
- `get_goal` — Get current thread goal — profiles: `coding`
- `create_goal` — Create a thread goal — profiles: `coding`
- `update_goal` — Complete or block a thread goal — profiles: `coding`
- `update_plan` — Track short work plan. — profiles: `coding`
- `skill_workshop` — Create, update, revise, list, inspect, apply, reject, or quarantine Skill Workshop proposals — profiles: `coding`

## Media (`media`)

- `image` — Image understanding — profiles: `coding`
- `image_generate` — Image generation — profiles: `coding`
- `music_generate` — Music generation — profiles: `coding`
- `video_generate` — Video generation — profiles: `coding`
- `tts` — Text-to-speech conversion — profiles: —

