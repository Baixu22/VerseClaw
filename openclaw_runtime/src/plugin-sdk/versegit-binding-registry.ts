import type {
  VerseGitBindingEndRequest,
  VerseGitBindingRecord,
  VerseGitRuntimeBindingPort,
} from "../../../shared/versegit-runtime-contract.js";

type RegisteredBinding = {
  binding: VerseGitBindingRecord;
  port: VerseGitRuntimeBindingPort;
};

const bindingsByRunId = new Map<string, RegisteredBinding>();

export function registerVerseGitRuntimeBinding(
  runId: string,
  binding: VerseGitBindingRecord,
  port: VerseGitRuntimeBindingPort,
): void {
  if (!runId.trim() || binding.childRunId !== runId || binding.phase !== "attached") {
    throw new Error("VerseGit binding registration requires an attached child run");
  }
  bindingsByRunId.set(runId, { binding, port });
}

export async function endVerseGitRuntimeBindingForRun(
  runId: string,
  reason: VerseGitBindingEndRequest["reason"],
): Promise<Error | null> {
  const registered = bindingsByRunId.get(runId);
  if (!registered) return null;
  bindingsByRunId.delete(runId);
  try {
    await registered.port.end({ bindingId: registered.binding.bindingId, reason });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export function clearVerseGitRuntimeBindingsForTest(): void {
  bindingsByRunId.clear();
}
