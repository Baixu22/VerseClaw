import { createHash, randomUUID } from "node:crypto";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { ProviderSpendScope } from "../../agents/provider-spend-budget.js";
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import {
  resolveProjectIdForWorkspace,
  type WorkspaceId,
  type SessionKey,
} from "../../../../shared/types/identity-scope.js";
import type { RetrievalSpendUsage } from "../../../../shared/knowledge/retrieval.js";
export type { RetrievalSpendUsage } from "../../../../shared/knowledge/retrieval.js";

export type RetrievalSpendBudget = { requestId: string; maxTokens: number; maxCostUsd: number };
export type RetrievalSpendCall = <T>(
  input: { providerRef: string; model: string; texts: string[]; signal: AbortSignal },
  operation: (reportInputTokens: (tokens: unknown) => void) => Promise<T>,
) => Promise<T>;

/** Only configured input-token tariffs qualify; missing or default-zero prices do not mean free. */
export function createRetrievalSpend(input: {
  budget: RetrievalSpendBudget;
  config: OpenClawConfig;
  workspaceId: string;
  sessionKey: string;
  sessionGeneration: string;
  assertScope: () => void;
  database?: OpenClawStateDatabaseOptions;
}) {
  const { budget } = input;
  if (
    typeof budget.requestId !== "string" ||
    !budget.requestId.trim() ||
    budget.requestId.length > 128 ||
    !Number.isSafeInteger(budget.maxTokens) ||
    budget.maxTokens < 1 ||
    budget.maxTokens > 4000 ||
    !Number.isFinite(budget.maxCostUsd) ||
    budget.maxCostUsd <= 0 ||
    budget.maxCostUsd > 0.0125
  )
    throw new Error("Invalid Research retrieval budget");
  const scope: ProviderSpendScope = {
    workspaceId: input.workspaceId as WorkspaceId,
    projectId: resolveProjectIdForWorkspace(input.workspaceId as WorkspaceId),
    sessionKey: input.sessionKey as SessionKey,
    sessionGeneration: input.sessionGeneration,
  };
  const runId =
    "research-retrieval:" +
    createHash("sha256")
      .update(JSON.stringify([scope, budget.requestId]))
      .digest("hex");
  const call: RetrievalSpendCall = async (request, operation) => {
    request.signal.throwIfAborted();
    input.assertScope();
    const provider = Object.entries(input.config.models?.providers ?? {}).find(
      ([name]) => name.trim().toLowerCase() === request.providerRef.trim().toLowerCase(),
    )?.[1];
    const tariff = provider?.models?.find((model) => model.id === request.model)?.cost;
    if (!tariff || !Number.isFinite(tariff.input) || tariff.input <= 0 || tariff.output !== 0)
      throw new Error("remote-retrieval-cost-unquoted");
    const inputPrice = tariff.input;
    // UTF-8 bytes plus framing bound dispatch; only the response settles billed input tokens.
    const reservedTokens = request.texts.reduce(
      (sum, text) => sum + Buffer.byteLength(text, "utf8") + 512,
      0,
    );
    const reservedCostUsd = (reservedTokens * inputPrice) / 1e6;
    const owner = await import("../../agents/provider-spend-budget.js");
    request.signal.throwIfAborted();
    input.assertScope();
    const reservation = owner.reserveProviderSpend(
      {
        callId: randomUUID(),
        runId,
        scope,
        provider: request.providerRef,
        model: request.model,
        requestDigest: createHash("sha256").update(JSON.stringify(request.texts)).digest("hex"),
        reservedTokens,
        reservedCostUsd,
        config: input.config.runtime?.providerBudget ?? {},
        runBudget: budget,
      },
      input.database,
    );
    let sent = false,
      actualTokens: number | null = null;
    try {
      request.signal.throwIfAborted();
      input.assertScope();
      owner.markProviderSpendSent(reservation, input.database);
      sent = true;
      const value = await operation((tokens) => {
        actualTokens =
          typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null;
      });
      request.signal.throwIfAborted();
      input.assertScope();
      if (actualTokens !== null && actualTokens > reservedTokens)
        throw new Error("remote-retrieval-usage-exceeds-reservation");
      return value;
    } finally {
      if (!sent) owner.cancelUnsentProviderSpend(reservation, input.database);
      else
        owner.reconcileProviderSpend(
          reservation,
          {
            tokens: actualTokens,
            costUsd: actualTokens === null ? null : (actualTokens * inputPrice) / 1e6,
            evidenceRef: "retrieval-response:" + reservation.callId,
          },
          input.database,
        );
    }
  };
  return {
    call,
    async snapshot(): Promise<RetrievalSpendUsage> {
      const owner = await import("../../agents/provider-spend-budget.js");
      const value = owner.providerSpendForRun(runId, input.database);
      return value.calls
        ? value
        : { calls: 0, reservedTokens: 0, reservedCostUsd: 0, actualTokens: 0, actualCostUsd: 0 };
    },
  };
}
