# TF-0419 Main Blocking I/O Evidence

This fixture reuses the TF-0418 startup measurement shape and retains the
five-launch `before.json` captured on main at `3d903a73` (TF-0418 landed).
The TF-0419 after run measures the same four marks after moving the extension
manifest read to async I/O, deferring launch-at-startup maintenance, and
starting the Gateway only after the window's ready-to-show event.

The report is local, agent-driven, and does not claim cross-platform or
release-benchmark timing.
