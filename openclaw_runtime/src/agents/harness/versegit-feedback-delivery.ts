import type { OpenClawAgentToolResult } from "../../plugins/agent-tool-result-middleware-types.js";
import type { VerseGitFeedbackDelivery, VerseGitToolObservationRecord } from "../../../../shared/versegit-runtime-contract.js";

function hasFeedbackMarker(result: OpenClawAgentToolResult, evidenceId: string): boolean {
  return result.content.some((entry) => entry.type === "text" && entry.text.includes(`evidence_id=${evidenceId}`));
}

export function appendVerseGitFeedbackToToolResult(
  result: OpenClawAgentToolResult,
  feedback: VerseGitFeedbackDelivery,
): { result: OpenClawAgentToolResult; appended: boolean } {
  if (hasFeedbackMarker(result, feedback.evidenceId)) {
    return { result, appended: false };
  }
  const details = result.details && typeof result.details === "object" && !Array.isArray(result.details)
    ? result.details as Record<string, unknown>
    : {};
  return {
    appended: true,
    result: {
      content: [...result.content, { type: "text", text: feedback.message }],
      details: {
        ...details,
        versegit_feedback: {
          evidence_id: feedback.evidenceId,
          basis_digest: feedback.basisDigest,
          candidate_id: feedback.candidateId,
          coverage: feedback.coverage,
          delivery_level: "host-delivered",
        },
      },
    },
  };
}

export async function enrichToolResultWithVerseGitFeedback(params: {
  result: OpenClawAgentToolResult;
  observe: () => Promise<VerseGitToolObservationRecord>;
  reportDelivery: (feedback: VerseGitFeedbackDelivery) => Promise<unknown>;
}): Promise<{
  result: OpenClawAgentToolResult;
  appended: boolean;
  feedback: VerseGitFeedbackDelivery | null;
  error: string | null;
}> {
  let observation: VerseGitToolObservationRecord;
  try {
    observation = await params.observe();
  } catch (error) {
    return {
      result: params.result,
      appended: false,
      feedback: null,
      error: String((error as Error)?.message ?? error).slice(0, 240),
    };
  }
  const feedback = observation.feedback ?? null;
  if (!feedback) {
    return { result: params.result, appended: false, feedback: null, error: null };
  }
  const delivery = appendVerseGitFeedbackToToolResult(params.result, feedback);
  if (!delivery.appended) {
    return { result: delivery.result, appended: false, feedback, error: null };
  }
  try {
    await params.reportDelivery(feedback);
  } catch (error) {
    return {
      result: delivery.result,
      appended: true,
      feedback,
      error: String((error as Error)?.message ?? error).slice(0, 240),
    };
  }
  return { result: delivery.result, appended: true, feedback, error: null };
}
