import {
  VG_FEEDBACK_DELIVERY_SCHEMA,
  VG_TOOL_OBSERVATION_SCHEMA,
  type VerseGitFeedbackDeliveryResponse,
  type VerseGitRuntimeObservationPort,
  type VerseGitToolObservationRecord,
} from "../../../shared/versegit-runtime-contract.js";

type RuntimeEnv = Record<string, string | undefined>;

export function createVerseGitRuntimeObservationPortFromEnv(env: RuntimeEnv = process.env): VerseGitRuntimeObservationPort | null {
  const baseUrl = env.CLAWX_VERSGIT_RUNTIME_BINDING_URL?.trim();
  const token = env.CLAWX_VERSGIT_BINDING_TOKEN?.trim();
  const ownerId = env.CLAWX_VERSGIT_OWNER_ID?.trim();
  const epoch = Number(env.CLAWX_VERSGIT_EPOCH ?? 0);
  if (env.CLAWX_VERSGIT_BINDING_ENABLED !== "1" || !baseUrl || !token || !ownerId || !Number.isInteger(epoch) || epoch < 1) {
    return null;
  }
  return {
    async observe(request) {
      const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/observe`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...request, schema: VG_TOOL_OBSERVATION_SCHEMA, ownerId, epoch }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json() as { ok?: boolean; data?: VerseGitToolObservationRecord; error?: { code?: string; message?: string } };
      if (!response.ok || body.ok !== true || !body.data) {
        throw Object.assign(new Error(body.error?.message || "VerseGit observation bridge failed"), {
          code: body.error?.code ?? "OBSERVATION_BRIDGE_FAILED",
          status: response.status,
        });
      }
      return body.data;
    },
    async reportDelivery(request) {
      const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/feedback-delivery`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...request, schema: VG_FEEDBACK_DELIVERY_SCHEMA, ownerId, epoch }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json() as { ok?: boolean; data?: VerseGitFeedbackDeliveryResponse; error?: { code?: string; message?: string } };
      if (!response.ok || body.ok !== true || !body.data) {
        throw Object.assign(new Error(body.error?.message || "VerseGit feedback delivery failed"), {
          code: body.error?.code ?? "FEEDBACK_DELIVERY_FAILED",
          status: response.status,
        });
      }
      return body.data;
    },
  };
}
