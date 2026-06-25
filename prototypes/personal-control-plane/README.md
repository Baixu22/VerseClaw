# Personal Control Plane Prototype

This is a local-first prototype for a personal developer task inbox. It is not a
cloud service. A small local bridge serves the UI, accepts structured task
envelopes over localhost, persists them to JSON, and streams updates to the UI
with Server-Sent Events.

## Run

```bash
node server.mjs
```

Open:

```text
http://127.0.0.1:42173
```

## Rebuild The UI

The UI is a small Vite React app with local shadcn-style components, Radix
Select, Tailwind tokens, and lucide icons. It builds into `public/`, which is
the directory served by `server.mjs`.

```bash
node ../../node_modules/vite/bin/vite.js build
```

## Submit A Task

```bash
node submit-task.mjs message "Review branch" "Check the current branch before I continue."
node submit-task.mjs doctor diagnose
node submit-task.mjs settings '{"theme":"dark"}'
```

## Prototype Architecture

```text
Local CLI / URL scheme / folder watcher
              |
              v
        Local bridge API
              |
              v
 Task inbox -> approval gate -> executor -> audit log
              |
              v
            UI SSE
```

The same shape can later move into Tauri:

- Tauri frontend: React, Tailwind or native CSS modules, Radix/shadcn-style components.
- Tauri backend: Rust commands for task store, approval, execution, filesystem watching, and device pairing.
- Optional transports: folder inbox, Git-backed inbox, LAN QR pairing, Tailscale-accessible local bridge.

## Safety Model

The prototype intentionally allows only three task kinds:

- `message`: records a note-like task and marks it completed when executed.
- `doctor`: simulates a diagnostic/fix command.
- `settingsPatch`: requires approval and only accepts whitelisted settings keys.

Settings patch execution is mocked inside this prototype; it records what would
be changed instead of editing the real app configuration.
