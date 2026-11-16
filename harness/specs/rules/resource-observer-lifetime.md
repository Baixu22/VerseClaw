---
id: resource-observer-lifetime
title: Window visibility and resource observer ownership
type: ai-coding-rule
severity: error
---

Main aggregates visibility over live BrowserWindows. A hidden or closed window
cannot overwrite another visible window's state. Remove listeners when their
window closes and detach all power/window listeners when sampling stops.

Each sampling generation owns its async callbacks and shared timer registration.
Late results from a stopped generation cannot change the current gate. Stop and
restart release observation state without cancelling running executions.

Renderer resource observers retain one shared polling owner. Release only the
caller reference, make release idempotent, and stop observation on the last
reference. Do not invoke resource stop controls as part of observer cleanup.
Hidden observers issue no refresh or pressure-status requests. Visibility return
refreshes current state and disposal prevents queued work from restarting.
