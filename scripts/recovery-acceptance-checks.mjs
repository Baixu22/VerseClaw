import { existsSync } from "node:fs";
import { join } from "node:path";

export function assertRecoveryBuildInputs(root, electronPath) {
  if (typeof electronPath !== "string" || electronPath.trim() !== electronPath || !existsSync(electronPath))
    throw new Error("Recovery acceptance requires an installed Electron executable with no trailing whitespace");
  for (const file of ["dist-electron/main/index.js", "dist-electron/preload/index.js", "dist/index.html", "openclaw_runtime/dist/entry.js"]) {
    if (!existsSync(join(root, file)))
      throw new Error(`Recovery acceptance build input missing: ${file}; run build:vite and build:runtime before sampling`);
  }
}

/** The legacy control may fail quality thresholds, but both reports must have complete evidence. */
export function recoveryAcceptancePassed({ windowSamples, qualitySamples, candidateReport, legacyReport }) {
  return windowSamples === 30 && qualitySamples === 60
    && candidateReport?.evaluation?.status === "PASS"
    && ["PASS", "FAIL"].includes(legacyReport?.evaluation?.status)
    && candidateReport.rejectedEvidence?.length === 0
    && legacyReport.rejectedEvidence?.length === 0;
}
