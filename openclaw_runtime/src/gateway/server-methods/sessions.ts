// Sessions gateway methods implement list/create/patch/delete/reset/compact/
// restore/preview/send flows over session stores, transcripts, and active runs.
// Implementations live in the sessions.* family modules; this facade merges them.
import { sessionsCompactionHandlers } from "./sessions.compaction.js";
import { sessionsLifecycleHandlers } from "./sessions.lifecycle.js";
import { sessionsReadHandlers } from "./sessions.read.js";
import { sessionsRunControlHandlers } from "./sessions.run-control.js";
import { sessionActivityHandlers } from "./session-activity.js";
import type { GatewayRequestHandlers } from "./types.js";

export const sessionsHandlers: GatewayRequestHandlers = {
  ...sessionsReadHandlers,
  ...sessionsCompactionHandlers,
  ...sessionsLifecycleHandlers,
  ...sessionsRunControlHandlers,
  ...sessionActivityHandlers,
};
