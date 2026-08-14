import type { AgentToolUpdateCallback } from "../../agents/runtime/index.js";
import {
  CapabilityResultPointerService,
  type CapabilityResultPointer,
} from "./result-pointer.js";
import { TrustedCapabilityCatalog } from "./trusted-catalog.js";
import { CapabilityUnifiedResolver } from "./unified-resolver.js";

export type CapabilityToolExecutionEffectState =
  | "not_started"
  | "unknown"
  | "completed";

export class CapabilityToolExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly effectState: CapabilityToolExecutionEffectState,
  ) {
    super(`Capability Registry V3 tool execution failed: ${code}`);
    this.name = "CapabilityToolExecutionError";
  }
}

export type CapabilityToolExecutionServiceInput = {
  resolver: CapabilityUnifiedResolver;
  trustedCatalog: TrustedCapabilityCatalog;
  resultPointers: CapabilityResultPointerService;
  sessionId: string;
  taskId?: string;
  grantedPermissions: readonly string[];
  leaseTtlMs: number;
  resultPointerTtlMs: number;
};

export type CapabilityToolExecutionInput = {
  capabilityId: string;
  input: unknown;
  toolCallId?: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback;
};

export type CapabilityToolExecutionResult = {
  pointer: CapabilityResultPointer;
};

function requireOk<T>(
  result: { ok: true; value: T } | { ok: false; failure: { code: string } },
  effectState: CapabilityToolExecutionEffectState,
): T {
  if (!result.ok) {
    throw new CapabilityToolExecutionError(result.failure.code, effectState);
  }
  return result.value;
}

/** Shared execution chain for proxy, Code Mode, and provider-native adapters. */
export class CapabilityToolExecutionService {
  constructor(private readonly serviceInput: CapabilityToolExecutionServiceInput) {}

  async execute(params: CapabilityToolExecutionInput): Promise<CapabilityToolExecutionResult> {
    if (params.signal?.aborted) {
      throw new CapabilityToolExecutionError("execution-aborted", "not_started");
    }
    const described = requireOk(
      this.serviceInput.resolver.describe(params.capabilityId),
      "not_started",
    );
    if (described.kind !== "tool") {
      throw new CapabilityToolExecutionError("unsupported-kind", "not_started");
    }

    const issued = this.serviceInput.trustedCatalog.issueLease({
      sessionId: this.serviceInput.sessionId,
      capabilityId: described.capabilityId,
      ttlMs: this.serviceInput.leaseTtlMs,
      grantedPermissions: this.serviceInput.grantedPermissions,
    });
    if (!issued.ok) {
      throw new CapabilityToolExecutionError(issued.failure.code, "not_started");
    }

    try {
      let executed: Awaited<ReturnType<CapabilityUnifiedResolver["execute"]>>;
      try {
        executed = await this.serviceInput.resolver.execute({
          capabilityId: described.capabilityId,
          lease: issued.handle,
          sessionId: this.serviceInput.sessionId,
          input: params.input,
          ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
          ...(params.signal ? { signal: params.signal } : {}),
          ...(params.onUpdate ? { onUpdate: params.onUpdate } : {}),
          requiredPermissions: described.permissions ?? [],
        });
      } catch {
        // Once the trusted executor has been entered, an exception cannot prove
        // whether a target side effect started. Callers must not replay it.
        throw new CapabilityToolExecutionError("executor-failed", "unknown");
      }
      const execution = requireOk(executed, "not_started");
      const created = await this.serviceInput.resultPointers.create({
        sessionId: this.serviceInput.sessionId,
        ...(this.serviceInput.taskId ? { taskId: this.serviceInput.taskId } : {}),
        capabilityId: described.capabilityId,
        ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
        summary: "Tool result available.",
        result: execution.result,
        ttlMs: this.serviceInput.resultPointerTtlMs,
        permissions: described.permissions ?? [],
      });
      return { pointer: requireOk(created, "completed") };
    } finally {
      this.serviceInput.trustedCatalog.revokeLease(issued.handle);
    }
  }
}

