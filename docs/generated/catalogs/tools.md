# Core Tool Catalog (generated)

<!-- GENERATED FILE — DO NOT EDIT.
Source of truth: openclaw_runtime/src/agents/tool-catalog.ts
Regenerate: pnpm catalogs:gen   |   Check freshness: pnpm catalogs:check
Generated at: 2026-10-25T07:02:27.220Z
-->

Built-in core tool sections with their profiles. This file is generated —
edit the source of truth instead, then run pnpm catalogs:gen.

## Files (`fs`)

- `read` — Read file contents — profiles: `coding`
- `ls` — List directory contents — profiles: `coding`
- `write` — Create or overwrite files — profiles: `coding`
- `edit` — Make precise edits — profiles: `coding`
- `apply_patch` — Patch files — profiles: `coding`
- `read_file` — Read a workspace file through the VerseShell read-only facade — profiles: `coding`
- `read_files` — Read several workspace files in one bounded call through the VerseShell read-only facade — profiles: `coding`
- `search_content` — Search file contents through the VerseShell read-only facade — profiles: `coding`
- `result_query` — Query a VerseShell result artifact handle by mode (meta/head/tail/slice/grep) — profiles: `coding`
- `undo_write` — Restore the previous snapshot of a file from the write journal — profiles: `coding`

## Runtime (`runtime`)

- `exec` — Run shell now. — profiles: `coding`
- `process` — Inspect/control exec sessions. — profiles: `coding`
- `wait` — Resume a suspended Code Mode run returned by exec — profiles: `coding`
- `verseshell_result` — Inspect a result:// artifact returned by exec (bounded slice) — profiles: `coding`
- `tool_search` — Search the session tool catalog by name or description — profiles: `coding`
- `tool_search_code` — Run JavaScript in the Tool Search sandbox to query the session tool catalog — profiles: `coding`
- `tool_describe` — Show the schema and description of a tool found via tool_search — profiles: `coding`
- `tool_call` — Invoke a tool found via tool_search — profiles: `coding`
- `code_execution` — Run sandboxed remote analysis — profiles: `coding`

## Web (`web`)

- `web_search` — Search the web — profiles: `coding`
- `web_fetch` — Fetch web content — profiles: `coding`
- `x_search` — Search X posts — profiles: `coding`

## Memory (`memory`)

- `memory_search` — Semantic search — profiles: `coding`
- `memory_get` — Read memory files — profiles: `coding`
- `memory_query` — Search the agent's long-term memory store for stored facts — profiles: `coding`
- `context_read` — Read full context blocks on demand — profiles: `coding`
- `context_archive_recall` — Read a bounded excerpt from a masked observation archive — profiles: `coding`
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
- `agent_browser` — Drive the internal Agent Browser for web automation — profiles: `coding`
- `canvas` — Control node Canvas surfaces when the Canvas plugin is enabled — profiles: —

## Messaging (`messaging`)

- `message` — Send messages — profiles: `messaging`

## Automation (`automation`)

- `heartbeat_respond` — Record heartbeat outcomes — profiles: —
- `cron` — Schedule reminders, cron, wake events. — profiles: `coding`
- `select_automation_playbook` — Pick a browser-automation playbook for the current request — profiles: `coding`
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
- `pdf` — Convert HTML to PDF documents — profiles: `coding`
- `transcripts` — Start, stop, import, summarize, or inspect meeting transcripts — profiles: `coding`
- `tts` — Text-to-speech conversion — profiles: —

