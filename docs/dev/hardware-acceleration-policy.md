# Hardware acceleration policy (product-locked default)

- Status: **product-locked default (frozen)**. An agent may not flip it.
- Behaviour owner: `electron/main/index.ts` (Main process startup).
- Registered by: GitHub issue [#152](https://github.com/Baixu22/VerseClaw/issues/152).
- Machine check: `pnpm docs:policy:validate`
  (`scripts/validate-policy-docs.mjs`).

## Shipped behaviour

Verse Claw calls `app.disableHardwareAcceleration()` **unconditionally** during
Main-process startup, before `app.whenReady()` and before any window is created.
There is no branch, no environment variable, no persisted setting and no command
line parsing that can skip it. Every platform, on every launch, renders in
software.

## What does not exist

Because issue #152 was filed against a comment that promised otherwise, this
section is explicit:

- `--enable-gpu` **does not exist**. No argv parser accepts it, and no code
  reads it.
- A `"disable-hardware-acceleration": false` app-config key **does not exist**.
  It is not in the config schema, the settings store, the settings UI or the
  i18n catalogs.
- No settings toggle, environment variable or developer flag re-enables GPU
  compositing.

The comment in `electron/main/index.ts` previously presented the first two as
working user options. That promise has been removed. The validator fails if
`--enable-gpu`, `enableGpu` or a `*-hardware-acceleration` config key reappears
in the Main-process source without an implementation behind it.

## Why the default is locked

The rationale is recorded in the source comment and is preserved here so it does
not have to be re-derived:

- Page and file loading is asynchronous data fetching and has no GPU
  dependency.
- The earlier per-platform GPU branching existed to keep CPU rendering from
  competing with synchronous I/O on Windows; file I/O is now asynchronous, so
  that concern no longer applies.
- Software rendering is deterministic across vendors and driver versions, while
  GPU compositing behaviour varies between Intel, AMD, NVIDIA and Apple Silicon
  and is a leading source of Electron rendering defects.

Per the repository's agent-role policy, changing a frozen default is a
publisher decision, not an agent decision. This record therefore **documents and
locks** the existing behaviour; it does not open the switch, and no evidence in
this repository shows that GPU acceleration would be faster for Verse Claw's
workloads.

## What is missing (do not overclaim)

- There is **no** multi-monitor, high-DPI or long-list rendering performance
  baseline for either software or GPU compositing. No claim that acceleration is
  faster, slower or neutral is supported today.
- There is **no** rollback path for a future acceleration experiment, because no
  experiment has been run.
- There is **no** upstream GPU bug inventory; vendor stability is a rationale,
  not a measured comparison.

## If this default is ever changed

Any change requires all of the following in one change set, plus publisher
authorization for the frozen default:

1. An explicit opt-in surface: either argv parsing or a config key that is
   actually read — not a comment.
2. Schema validation for the new key, and a documented default.
3. i18n coverage for every user-visible string in all four locales
   (`en` / `zh` / `ja` / `ru`).
4. Electron E2E coverage of the interaction, per the repository UI-change rule.
5. A before/after performance artifact pair produced by agent-driven runs on a
   named machine, so the change is measured rather than asserted.
6. A rollback path that restores software rendering without a reinstall.

## Verification

```bash
pnpm docs:policy:validate
```

The check confirms that the Main-process source does not advertise a
non-existent switch, that this decision record still states the lock, that its
references resolve, and that `SECURITY.md` keeps its matching support scope.

Runtime efficiency observability work measures the runtime this decision trades
against, and its Harness task spec keeps changing this default explicitly out of
scope. Neither of those documents owns this default.
