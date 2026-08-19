// Stage 2 transform-graph projection. The graph is a read-only projection of
// the existing RC-03 seal registry: no producer is invented and an id that is
// not registered can never enter the snapshot.
import type { RegisteredTransform } from '../../../shared/types/context-control-plane/artifacts.js';
import {
  getRegisteredSealProducers,
  sealProducerDigest,
  type SealProducerRegistration,
} from './seal-registry.js';
import { registerRc03SealProducers } from './rc03-producers.js';

export function sealRegistrationToRegisteredTransform(
  registration: SealProducerRegistration,
): RegisteredTransform {
  return {
    id: registration.id,
    kind: registration.kind,
    mutates: registration.mutates === 'tool-schema' ? 'tool_schema' : registration.mutates,
    version: registration.version,
    registeredDigest: `sha256:${sealProducerDigest(registration)}`,
  };
}

/**
 * Project the RC-03 seal registry in id order. When the caller supplies the
 * actual applied transform ids for this model call, only those ids enter the
 * frozen graph; otherwise the full registered graph is projected (synthetic
 * and contract fixtures use this caller-owned projection).
 */
export function buildStage2TransformGraph(options?: {
  transformIds?: readonly string[];
}): RegisteredTransform[] {
  registerRc03SealProducers();
  const all = getRegisteredSealProducers()
    .map((registration) => sealRegistrationToRegisteredTransform(registration))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  if (!options?.transformIds) return all;
  const selected = new Set(options.transformIds);
  return all.filter((transform) => selected.has(transform.id));
}

export function registeredTransformIds(transforms: readonly RegisteredTransform[]): string[] {
  return transforms.map((transform) => transform.id).toSorted();
}
