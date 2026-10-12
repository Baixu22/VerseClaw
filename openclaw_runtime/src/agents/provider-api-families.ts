/**
 * Small API-family predicates used when constructing provider payloads. The
 * sets here encode transport-level compatibility, not provider identity.
 *
 * Membership comes from the capability descriptor
 * (`upstream-protocol-capabilities.ts`) rather than a local list: the managed transport
 * rewrites a public api id to its in-tree spelling, and a local list keyed on the public
 * ids silently stops matching on that path (see
 * harness/specs/tasks/upstream-protocol-capability-descriptor.md).
 */
import { isOpenAIFamilyApi } from "./upstream-protocol-capabilities.js";

/** True when a provider API accepts GPT parallel-tool-call payload settings. */
export function supportsGptParallelToolCallsPayload(api: unknown): boolean {
  return isOpenAIFamilyApi(api);
}
