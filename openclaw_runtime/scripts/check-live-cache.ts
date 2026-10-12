// Check Live Cache script supports OpenClaw repository automation.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLiveCacheRegressionGateReport } from "../src/agents/live-cache-regression-report.js";
import { collectProviderApiKeys } from "../src/agents/live-auth-keys.js";
import { runLiveCacheRegression } from "../src/agents/live-cache-regression-runner.js";
import { LIVE_CACHE_TEST_ENABLED, logLiveCache } from "../src/agents/live-cache-test-support.js";

const reportPath = fileURLToPath(
  new URL("../../artifacts/prompt-cache-live-cache/report.json", import.meta.url),
);

async function writeReport(report: ReturnType<typeof buildLiveCacheRegressionGateReport>) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (!LIVE_CACHE_TEST_ENABLED) {
  const report = buildLiveCacheRegressionGateReport({
    measured: false,
    regressions: ["unmeasured: set OPENCLAW_LIVE_TEST=1 and OPENCLAW_LIVE_CACHE_TEST=1"],
  });
  await writeReport(report);
  logLiveCache(`unmeasured; wrote ${reportPath}`);
  process.exit(1);
}

const hasLiveCredentials =
  collectProviderApiKeys("anthropic").length > 0 || collectProviderApiKeys("openai").length > 0;
if (
  !hasLiveCredentials &&
  process.env.OPENCLAW_LIVE_ALLOW_PROFILE_AUTH !== "1"
) {
  const report = buildLiveCacheRegressionGateReport({
    measured: false,
    regressions: ["unmeasured: no live provider credentials in environment"],
  });
  await writeReport(report);
  logLiveCache(`unmeasured credentials; wrote ${reportPath}`);
  process.exit(1);
}

try {
  const result = await runLiveCacheRegression();
  const report = buildLiveCacheRegressionGateReport({
    measured: true,
    summary: result.summary,
    regressions: result.regressions,
    warnings: result.warnings,
  });
  await writeReport(report);

  if (result.warnings.length > 0) {
    process.stderr.write("\n[live-cache] non-blocking cache observations:\n");
    for (const warning of result.warnings) {
      process.stderr.write(`- ${warning}\n`);
    }
  }
  if (result.regressions.length > 0) {
    process.stderr.write("\n[live-cache] regressions detected:\n");
    for (const regression of result.regressions) {
      process.stderr.write(`- ${regression}\n`);
    }
    process.exit(1);
  }
  process.stderr.write("\n[live-cache] all regression floors satisfied\n");
  process.exit(0);
} catch {
  const report = buildLiveCacheRegressionGateReport({
    measured: false,
    regressions: ["runner failed before producing a live-cache measurement"],
  });
  await writeReport(report);
  logLiveCache(`runner failed; wrote ${reportPath}`);
  process.exit(1);
}
