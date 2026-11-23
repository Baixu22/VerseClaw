type EditRejectionOwner = "edit-file-operations" | "edit-parameters" | "edit-workspace-guard";
type EditRejectionReceipt = Readonly<{ toolCallId: string; owner: EditRejectionOwner }>;
const editRejections = new WeakMap<object, EditRejectionReceipt>();

/** Only the file owner records a rejection observed before dispatching writeFile. */
export function recordEditNotApplied(
  error: unknown,
  toolCallId: string,
  owner: EditRejectionOwner = "edit-file-operations",
): Error {
  const normalized = error instanceof Error ? error : new Error(String(error), { cause: error });
  editRejections.set(normalized, Object.freeze({ toolCallId, owner }));
  return normalized;
}

export function readEditNotApplied(
  error: unknown,
  toolCallId: string,
  toolName: string,
): EditRejectionReceipt | undefined {
  if (toolName !== "edit" || !error || typeof error !== "object") return undefined;
  const receipt = editRejections.get(error);
  return receipt?.toolCallId === toolCallId ? receipt : undefined;
}
