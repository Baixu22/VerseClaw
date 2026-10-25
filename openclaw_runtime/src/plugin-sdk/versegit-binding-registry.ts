import type {
  VerseGitBindingEndRequest,
  VerseGitBindingRecord,
  VerseGitRuntimeBindingPort,
} from "../../../shared/versegit-runtime-contract.js";

type RegisteredBinding = {
  binding: VerseGitBindingRecord;
  port: VerseGitRuntimeBindingPort;
  ended: boolean;
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
  bindingsByRunId.set(runId, { binding, port, ended: false });
}

export function getVerseGitRuntimeBindingForRun(runId: string): VerseGitBindingRecord | null {
  return bindingsByRunId.get(runId)?.binding ?? null;
}

export function getVerseGitRuntimeBindingContextForRun(runId: string): {
  binding: VerseGitBindingRecord;
  port: VerseGitRuntimeBindingPort;
  ended: boolean;
} | null {
  const registered = bindingsByRunId.get(runId);
  return registered
    ? { binding: registered.binding, port: registered.port, ended: registered.ended }
    : null;
}

export async function endVerseGitRuntimeBindingForRun(
  runId: string,
  reason: VerseGitBindingEndRequest["reason"],
): Promise<Error | null> {
  const registered = bindingsByRunId.get(runId);
  if (!registered) return null;
  if (registered.ended) return null;
  try {
    await registered.port.end({ bindingId: registered.binding.bindingId, reason });
    registered.ended = true;
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export function clearVerseGitRuntimeBindingForRun(runId: string): void {
  bindingsByRunId.delete(runId);
}

export function clearVerseGitRuntimeBindingsForTest(): void {
  bindingsByRunId.clear();
}
