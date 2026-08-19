/**
 * Structured coding-runtime errors shared by the transaction service and the
 * P2 file-lock manager. Kept in its own module so lock acquisition paths can
 * return the same `E_LOCK_TIMEOUT` / `E_CONFLICT` contract without importing
 * the larger transaction service.
 */
import type {
  CodingRuntimeErrorCode,
  CodingRuntimeError as CodingRuntimeErrorInfo,
  FileVersion,
} from "../../../../shared/coding-runtime/types.js";

export class CodingRuntimeError extends Error implements CodingRuntimeErrorInfo {
  readonly code: CodingRuntimeErrorCode;
  readonly path?: string;
  readonly batchId?: string;
  readonly baseVersion?: FileVersion;
  readonly currentVersion?: FileVersion;
  readonly diff?: string;

  constructor(info: CodingRuntimeErrorInfo) {
    super(info.message);
    this.name = "CodingRuntimeError";
    this.code = info.code;
    if (info.path !== undefined) this.path = info.path;
    if (info.batchId !== undefined) this.batchId = info.batchId;
    if (info.baseVersion !== undefined) this.baseVersion = info.baseVersion;
    if (info.currentVersion !== undefined) this.currentVersion = info.currentVersion;
    if (info.diff !== undefined) this.diff = info.diff;
  }
}
