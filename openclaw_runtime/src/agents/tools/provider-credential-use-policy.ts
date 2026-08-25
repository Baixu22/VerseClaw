import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import {
  isExternalOrUnknownProvenance,
  provenanceStatus,
  type ContentProvenanceContext,
  type ProvenanceStatus,
} from "../../../../shared/security/content-provenance.js";

export type ProviderCredentialUsePolicyInput = {
  provenanceContext?: ContentProvenanceContext;
  hasExplicitModelOverride: boolean;
  requestedProvider?: string;
  boundProviderIds: readonly string[];
};

export type ProviderCredentialUsePolicyResult = {
  status: ProvenanceStatus;
  allowed: boolean;
  restricted: boolean;
  reason?: string;
};

/**
 * Prevent external or unknown content from selecting a provider credential
 * outside the host-owned configured/default scope. Credential values never
 * enter this decision.
 */
export function resolveProviderCredentialUsePolicy(
  input: ProviderCredentialUsePolicyInput,
): ProviderCredentialUsePolicyResult {
  const status = provenanceStatus(input.provenanceContext?.provenance);
  if (!input.hasExplicitModelOverride || !isExternalOrUnknownProvenance(status)) {
    return { status, allowed: true, restricted: false };
  }

  const requestedProvider = normalizeProviderId(input.requestedProvider ?? "");
  const boundProviders = new Set(input.boundProviderIds.map(normalizeProviderId).filter(Boolean));
  if (requestedProvider && boundProviders.has(requestedProvider)) {
    return { status, allowed: true, restricted: false };
  }

  return {
    status,
    allowed: false,
    restricted: true,
    reason:
      "Image generation provider override denied: external or unknown provenance may only use the configured image-generation provider scope.",
  };
}
