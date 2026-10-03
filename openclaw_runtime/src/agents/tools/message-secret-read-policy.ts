import {
  isExternalOrUnknownProvenance,
  provenanceStatus,
  type ContentProvenanceContext,
  type ProvenanceStatus,
} from "../../../../shared/security/content-provenance.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { CommandSecretReadTarget } from "../../gateway/cli-runtime/command-secret-gateway.js";
import { resolveEffectiveMessageToolsConfig } from "../../infra/outbound/outbound-policy.js";
import { normalizeOptionalAccountId } from "../../routing/account-id.js";
import { normalizeMessageChannel } from "../../utils/message-channel-normalize.js";

export type MessageSecretReadPolicyInput = {
  provenanceContext?: ContentProvenanceContext;
  currentChannel?: unknown;
  currentAccountId?: unknown;
  requestedChannel?: unknown;
  requestedAccountId?: unknown;
  selectedTargets?: readonly CommandSecretReadTarget[];
  cfg: OpenClawConfig;
  agentId?: string | null;
};

export type MessageSecretReadPolicyResult = {
  status: ProvenanceStatus;
  allowed: boolean;
  restricted: boolean;
  reason?: string;
};

function normalizeChannel(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeMessageChannel(value) : undefined;
}

function normalizeAccount(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptionalAccountId(value) : undefined;
}

function selectedTargetsCrossScope(params: {
  selectedTargets: readonly CommandSecretReadTarget[] | undefined;
  channel: string | undefined;
  accountId: string | undefined;
}): boolean {
  for (const target of params.selectedTargets ?? []) {
    const segments = target.pathSegments;
    if (segments[0] !== "channels") {
      continue;
    }
    const selectedChannel = normalizeChannel(segments[1]);
    if (!params.channel || !selectedChannel || selectedChannel !== params.channel) {
      return true;
    }
    if (segments[2] !== "accounts") {
      continue;
    }
    const selectedAccount = normalizeAccount(target.accountId ?? segments[3]);
    if (!params.accountId || !selectedAccount || selectedAccount !== params.accountId) {
      return true;
    }
  }
  return false;
}

/**
 * Keep message credential reads inside the bound provider/account for unknown
 * or external content. This is a sink-local check; outbound delivery still
 * owns target and cross-context authorization.
 */
export function resolveMessageSecretReadPolicy(
  input: MessageSecretReadPolicyInput,
): MessageSecretReadPolicyResult {
  const status = provenanceStatus(input.provenanceContext?.provenance);
  const risky = isExternalOrUnknownProvenance(status);
  if (!risky) {
    return { status, allowed: true, restricted: false };
  }

  const currentChannel = normalizeChannel(input.currentChannel);
  const requestedChannel = normalizeChannel(input.requestedChannel);
  const currentAccount = normalizeAccount(input.currentAccountId);
  const requestedAccount = normalizeAccount(input.requestedAccountId);
  const providerMismatch = Boolean(
    currentChannel && requestedChannel && currentChannel !== requestedChannel,
  );
  const accountMismatch = Boolean(
    !providerMismatch && currentAccount && requestedAccount && currentAccount !== requestedAccount,
  );
  const unknownProviderRedirect = Boolean(!currentChannel && requestedChannel);
  const unknownAccountRedirect = Boolean(!providerMismatch && requestedAccount && !currentAccount);
  const selectedTargetRedirect = selectedTargetsCrossScope({
    selectedTargets: input.selectedTargets,
    channel: requestedChannel ?? currentChannel,
    accountId: requestedAccount ?? currentAccount,
  });
  const restricted =
    providerMismatch ||
    accountMismatch ||
    unknownProviderRedirect ||
    unknownAccountRedirect ||
    selectedTargetRedirect;

  if (!restricted) {
    return { status, allowed: true, restricted: false };
  }

  const messageConfig = resolveEffectiveMessageToolsConfig({
    cfg: input.cfg,
    agentId: input.agentId,
  });
  if (messageConfig?.allowCrossContextSend === true) {
    return { status, allowed: true, restricted: true };
  }
  if (providerMismatch || unknownProviderRedirect) {
    if (messageConfig?.crossContext?.allowAcrossProviders === true) {
      return { status, allowed: true, restricted: true };
    }
  } else if (messageConfig?.crossContext?.allowWithinProvider === true) {
    return { status, allowed: true, restricted: true };
  }

  return {
    status,
    allowed: false,
    restricted: true,
    reason:
      "Message secret read denied: external or unknown provenance requires explicit operator cross-context permission for the requested channel/account.",
  };
}

export function assertMessageSecretReadAllowed(input: MessageSecretReadPolicyInput): void {
  const result = resolveMessageSecretReadPolicy(input);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
}
