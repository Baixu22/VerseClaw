---
id: windows-delivery-entry-boundary
title: Windows delivery entry points must not start unrelated work
type: ai-coding-rule
severity: error
---

CLI version/help and rejected commands must dispatch before loading runtime or
user configuration. Only an explicit supported Gateway command may start a
server. Keep Doctor and internal goal-wake dispatch intact.

Packaged Node must meet the source runtime engine requirement; validate the
actual binary, not only the download manifest. CLI executable names must agree
with the package identity.

Optional Defender integration must skip non-elevated installs and have a bounded
execution time when elevated. Installer helper errors must be visible and must
not be treated as a successful helper result. Tests must not elevate or disable
protection to obtain a pass.
