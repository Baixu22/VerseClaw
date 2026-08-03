// RC-03 seal registry. Semantic producers (COMPASS SSP, ContextEngine message
// replacement, DCS knowledge/working-memory/tool-registry, CVK additions, and
// any future semantic prompt addition) must register as PRE-SEAL producers.
// After the bundle is sealed, only registered NON-SEMANTIC transport transforms
// (digest, header, serialization) may run. Any unregistered semantic mutation
// fails closed (returns an error) so "unknown semantic mutation is zero".
import { createHash } from 'node:crypto';

export const SEAL_REGISTRY_SCHEMA = 'SealRegistry/v1' as const;

export type SealProducerKind = 'semantic' | 'non-semantic';

export type SealProducerRegistration = {
  /** Stable producer id, e.g. "compass-ssp", "cvk-message-replacement", "dcs-knowledge". */
  id: string;
  /** What this producer mutates: "system_prompt" | "messages" | "transport" | "tool-schema". */
  mutates: 'system_prompt' | 'messages' | 'transport' | 'tool-schema';
  kind: SealProducerKind;
  /** Human-readable purpose; registered before cutover, cannot be a direct bypass. */
  purpose: string;
  version: string;
};

const registry = new Map<string, SealProducerRegistration>();

/**
 * Register a seal producer. Semantic producers run before the bundle is sealed;
 * non-semantic (transport) transforms run after the seal. Duplicate ids are
 * rejected so no producer is silently shadowed.
 */
export function registerSealProducer(registration: SealProducerRegistration): void {
  if (registry.has(registration.id)) {
    throw new Error(`seal producer already registered: ${registration.id}`);
  }
  if (registration.kind === 'non-semantic' && registration.mutates !== 'transport') {
    throw new Error(`non-semantic seal producer must mutate only transport: ${registration.id}`);
  }
  if (registration.kind === 'semantic' && registration.mutates === 'transport') {
    throw new Error(`semantic seal producer cannot mutate transport: ${registration.id}`);
  }
  registry.set(registration.id, registration);
}

export function isSealProducerRegistered(id: string): boolean {
  return registry.has(id);
}

export function getSealProducer(id: string): SealProducerRegistration | undefined {
  return registry.get(id);
}

export function getRegisteredSealProducers(): SealProducerRegistration[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resetSealRegistryForTests(): void {
  registry.clear();
}

/**
 * Assert that a set of producer ids were all registered before the seal. Any
 * unregistered semantic mutation id is reported so unknown semantic mutation
 * stays zero.
 */
export function assertSealProducersRegistered(ids: readonly string[]): string[] {
  return ids.filter((id) => !registry.has(id));
}

/** Return the registered non-semantic (transport) transform ids in order. */
export function registeredTransportTransformIds(): string[] {
  return [...registry.values()]
    .filter((r) => r.kind === 'non-semantic')
    .map((r) => r.id)
    .sort();
}

export function sealProducerDigest(registration: SealProducerRegistration): string {
  return createHash('sha256').update(JSON.stringify(registration)).digest('hex');
}
