/**
 * Permission decision recording hook for agent-browser.
 *
 * Original implementation: electron/services/permissions-api.ts
 * `recordPermissionDecisionEvent` (source lines 165-176) writes into the
 * ClawX permission store. That store is host-app state, so this package
 * exposes an injectable recorder with a no-op default.
 */
import type { PermissionDecisionEvent } from '../types/product-semantics.ts';

export type PermissionDecisionRecorder = (
  event: PermissionDecisionEvent,
) => Promise<PermissionDecisionEvent> | PermissionDecisionEvent;

let recorder: PermissionDecisionRecorder = async (event) => event;

export function setPermissionDecisionRecorder(next: PermissionDecisionRecorder | null): void {
  recorder = next ?? (async (event) => event);
}

export async function recordPermissionDecisionEvent(
  event: PermissionDecisionEvent,
): Promise<PermissionDecisionEvent> {
  return recorder(event);
}
