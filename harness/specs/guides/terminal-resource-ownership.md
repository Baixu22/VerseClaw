---
id: terminal-resource-ownership
title: Terminal and governed process reservations, control and recovery
type: guide
appliesTo:
  - autonomy-terminal-resource-ownership
---

**Terminal PTYs and governed VerseShell processes use the existing managed-process capacity owner.** When `OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES` is declared, reservations are committed before launch in the shared Runtime SQLite `state_leases` table. Workspaces and runtime processes sharing that state directory consume the same capacity. Existing active limits remain effective until their reservations settle; lowering a limit never evicts active processes. No new default limit is introduced.

Known local TCP ports can be declared by the launch owner. The owner reserves them in the same short transaction as process capacity, checks external bind availability, and holds them until native terminal evidence and the port-release check both succeed. The web-preview launch path supplies its known expected port. Undeclared arbitrary shell listeners remain observed resources; the system does not infer launch authority by parsing arbitrary shell text. External programs do not participate in the managed reservation protocol, and a later external bind is reported through the native start/exit result.

Reservations record owner, PID for diagnosis, ports, limit and stage: reserved, dispatched, observed, terminal or unknown. PID presence and TTL never authorize killing or reclaiming an unknown process. The native owner marks a confirmed terminal result before deletion; a restart can safely finish that deletion. A reservation whose owner died before dispatch can also be released. A dispatched operation without a terminal receipt stays unknown and visible in `terminal.list.processReservations`. It does not silently vanish or free capacity. Recovery calls run before terminal/Gateway managed launches and use the same owner records; no separate scheduler or resource database is added.

PTY input, resize, interrupt and close can carry workspace, conversation and physical generation. The desktop panel supplies the identity returned by the terminal owner. A mismatched identity rejects before native interaction, and a known-generation terminal cannot be reused without the same generation. Native PTY input is synchronously serialized by its owner. Background output and control keep the existing bounded process/ACI paths.

The terminal owner releases its slot only after native exit. A still-occupied declared port keeps the reservation and reports recovery required; a later close rechecks it. If native start fails without returning an owned handle, the durable reservation records the unknown result and its ID. The code does not guess a PID or report successful cleanup. Web-preview proxy startup failures close the already-created terminal; failed cleanup retains an error runtime with its terminal reference for retry.

Windows environment variables are preserved through existing environment builders. Per-run Job Object limits, total deadlines, no-replay handling for effectful starts, native process-tree termination and bounded output/artifact references remain VerseShell-owned. Interactive PTYs are not automatically restarted and submitted input is never replayed after owner loss.

Validation distinguishes actual native PTY/process/tree/SQLite/socket tests from unit substitutes and Electron UI tests using typed host mocks. Native executor test copies must match the checked-in binary manifest; any installed-path failure is retained separately. Shared-state scope is local to the configured state directory; separate installations with separate state directories do not claim one global budget.
