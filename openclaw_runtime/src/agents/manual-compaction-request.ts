/** A current-attempt request to compact its own session after transcript lock release. */
export type ManualCompactionRequest = {
  customInstructions?: string;
};

export type ManualCompactionRequestStatus = "accepted" | "already_requested";

/** Keeps the first request so one model turn can schedule at most one compaction. */
export function registerManualCompactionRequest(
  pending: ManualCompactionRequest | undefined,
  requested: ManualCompactionRequest,
): { pending: ManualCompactionRequest; status: ManualCompactionRequestStatus } {
  if (pending) {
    return { pending, status: "already_requested" };
  }
  return { pending: requested, status: "accepted" };
}
