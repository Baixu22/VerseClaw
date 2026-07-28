/**
 * FP-P0-04: gateway restart generation.
 *
 * Every gateway child is stamped with a monotonically increasing generation via
 * `VERSE_CLAW_GATEWAY_GENERATION`. The control plane records the generation it is
 * waiting on before restarting, then discards any acknowledgement whose
 * `gatewayGeneration` does not match — an ack from the pre-restart child would
 * otherwise "prove" that a flag applied when it never reached the new child.
 */
export const GATEWAY_GENERATION_ENV = 'VERSE_CLAW_GATEWAY_GENERATION';

let currentGeneration = 0;

/** Bump and return the generation for a child about to be spawned. */
export function nextGatewayGeneration(): string {
  currentGeneration += 1;
  return String(currentGeneration);
}

/** Generation of the most recently spawned child ('0' before any spawn). */
export function getCurrentGatewayGeneration(): string {
  return String(currentGeneration);
}

/** Test helper: reset the counter. */
export function resetGatewayGenerationForTests(): void {
  currentGeneration = 0;
}

/** Stamp the generation onto a child env map (mutates and returns it). */
export function stampGatewayGeneration(
  env: Record<string, string | undefined>,
  generation: string,
): Record<string, string | undefined> {
  env[GATEWAY_GENERATION_ENV] = generation;
  return env;
}
