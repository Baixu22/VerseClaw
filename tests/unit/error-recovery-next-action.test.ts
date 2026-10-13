// @vitest-environment node
// G01: bounded, permission-scoped recovery actions on AppError.
import { describe, expect, it } from "vitest";

import {
  APP_ERROR_CODES,
  AppError,
  ERROR_RECOVERY_TABLE,
  isRetryableAppErrorCode,
  recoveryActionForAppErrorCode,
  type AppErrorCode,
} from "../../src/lib/error-model";

const RECOVERY_KINDS = ["retry", "reauthenticate", "reconfigure", "open-settings", "contact-support"];

describe("G01 error recovery next-action", () => {
  it("classifies every error code with a bounded recovery entry", () => {
    for (const code of APP_ERROR_CODES) {
      const entry = ERROR_RECOVERY_TABLE[code];
      expect(entry, code).toBeDefined();
      expect(typeof entry.retryable, code).toBe("boolean");
      expect(["self-retry", "user-action-required"], code).toContain(entry.scope);
    }
  });

  it("only self-retry classes are retryable, and they carry exactly the retry action", () => {
    for (const code of APP_ERROR_CODES) {
      const entry = ERROR_RECOVERY_TABLE[code];
      expect(isRetryableAppErrorCode(code), code).toBe(entry.retryable);
      if (entry.retryable) {
        expect(entry.scope, code).toBe("self-retry");
        expect(entry.action, code).toEqual({ kind: "retry" });
      } else {
        expect(entry.scope, code).toBe("user-action-required");
        expect(entry.action?.kind, code).not.toBe("retry");
      }
    }
  });

  it("never emits a shell command or raw script as a recovery action", () => {
    for (const code of APP_ERROR_CODES) {
      const action = recoveryActionForAppErrorCode(code);
      if (!action) continue;
      expect(RECOVERY_KINDS, code).toContain(action.kind);
      expect(Object.keys(action).sort(), code).toEqual(
        action.target === undefined ? ["kind"] : ["kind", "target"],
      );
      // No executable/raw fields may appear.
      for (const forbidden of ["command", "cmd", "script", "shell", "exec", "argv"]) {
        expect(JSON.stringify(action).includes(forbidden), `${code}: ${forbidden}`).toBe(false);
      }
    }
  });

  it("carries retryable + nextAction on AppError and leaves UNKNOWN without an action", () => {
    const timeout = new AppError("TIMEOUT", "timed out");
    expect(timeout.retryable).toBe(true);
    expect(timeout.nextAction).toEqual({ kind: "retry" });

    const permission = new AppError("PERMISSION", "denied");
    expect(permission.retryable).toBe(false);
    expect(permission.nextAction).toEqual({ kind: "open-settings", target: "permissions" });

    const unknown = new AppError("UNKNOWN", "boom");
    expect(unknown.retryable).toBe(false);
    expect(unknown.nextAction).toBeUndefined();
  });

  it("is total: any AppErrorCode resolves deterministically", () => {
    for (const code of APP_ERROR_CODES as readonly AppErrorCode[]) {
      const first = recoveryActionForAppErrorCode(code);
      const second = recoveryActionForAppErrorCode(code);
      expect(first).toEqual(second);
    }
  });
});