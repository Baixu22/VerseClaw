// Test API surface for the Matrix plugin, loaded by the QA runner harness
// (`loadQaRunnerBundledPluginTestApi<MatrixQaE2eeRuntime>("matrix")`). Exposes
// the runtime plus the E2EE/verification primitives the QA substrate drives.
export { getMatrixRuntime, getOptionalMatrixRuntime, setMatrixRuntime } from "./src/runtime.js";
export { MatrixClient } from "./src/matrix/sdk.js";
export type {
  ConsoleLogger,
  EncryptedFile,
  LogService,
  MatrixDeviceVerificationStatus,
  MatrixOwnDeviceDeleteResult,
  MatrixOwnDeviceInfo,
  MatrixOwnDeviceVerificationStatus,
  MatrixRawEvent,
  MatrixRecoveryKeyVerificationResult,
  MatrixRoomKeyBackupResetResult,
  MatrixRoomKeyBackupRestoreResult,
  MatrixRoomKeyBackupStatus,
  MatrixVerificationBootstrapResult,
  MessageEventContent,
} from "./src/matrix/sdk.js";
export type { MatrixVerificationMethod, MatrixVerificationSummary } from "./src/matrix/sdk/verification-manager.js";
