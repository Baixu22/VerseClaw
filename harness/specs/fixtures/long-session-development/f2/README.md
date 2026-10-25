# F2 long-use budget evidence

Source candidate: 18982d5e6c8d66f96bc0c3ebbfc4cb44ba52b997 (branch codex/long-session-implementation-20261022, tree aa24137b2585e65e08f7d29139ccbc7ba71a8c84).

Budgets are declared in shared/long-session-budget.ts BEFORE measurement and are read back
from that module by both the regression test and this driver, so a published number can
never be silently loosened to match a sample.

- long-use-before-after.json: the frozen 333-session / 57.16 MiB built-Electron fixture with load, switch,
NaN
NaN
- rss-and-owner-counts.json: the five-minute idle RSS curve plus 50 owner-lifecycle rounds of terminal, admission, envelope, timer, watcher and label-hydration
NaN
- notification-budget.json: duplicate completion, oversized batch, replayed notification,
NaN
- verification-receipt.json: acceptance mapping, gate receipt, counts, cleanup and honest limits.

The measured fixture is synthetic and agent-generated. Real human long use, macOS/Linux
samples, live-provider transcripts and the packaged build stay explicitly unmeasured.
TF-0423 history artifacts are referenced only and were not re-signed or reused here.

All actions are agent-driven (driven_by: agent, actor: codex-long-session-f2). No real-human
operation, verdict or data is claimed.
