---
id: resource-bounded-waiting
title: Resource waiting bounds and execution ownership
type: ai-coding-rule
severity: error
---

Use the existing Main ResourceFabric and runtime workspace lease owners. Waiting
capacity excludes active leases; reject before adding an excess waiter. Preserve
QoS, stable FIFO, path conflicts, timeout error codes and idempotent release.

Accept AbortSignal and an absolute Unix-millisecond deadline. Check before enqueue,
at grant and before executing an admitted callback. Remove the waiter, timeout and
abort listener on every terminal waiting transition. Expiration must wake successors.
Execution adapters consume the remaining deadline rather than restart a full timeout.

Singleflight subscribers own their waits separately. One cancellation must not
cancel work needed by another subscriber. With no subscribers left, pending work
can be cancelled; running capacity remains owned until actual work settles.
Fresh callers may replace an abandoned flight. Its eventual completion must not
remove the replacement's registration or release the replacement's capacity.
Cancellation alone is never evidence that a child or remote operation has exited.
Once execution starts, its owner supplies the terminal result, including confirmed
file-write readback. The waiting layer must not replace that receipt with an
admission timeout or cancellation error.

Keep 200-request coverage with explicit outcomes, active/waiting peaks and final
lease/timer/listener counts. Freeze a clean source candidate for node acceptance.
