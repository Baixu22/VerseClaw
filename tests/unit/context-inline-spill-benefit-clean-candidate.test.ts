// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const actor = "codex-g7-inline-spill-tf0749-01a1d34c";
const cli = resolve("openclaw_runtime/node_modules/tsx/dist/cli.mjs");
const script = resolve("scripts/context-inline-spill-benefit-loop-eval.mts");
const freeze = resolve("harness/specs/fixtures/context-inline-spill-benefit-round6/design.freeze.json");
function execute(output: string, args: string[], cwd = root, preload?: string) {
  return spawnSync(process.execPath, [cli, "--tsconfig", resolve(root, "openclaw_runtime/tsconfig.json"),
    ...(preload ? ["--import", pathToFileURL(preload).href] : []), script,
    "--mode", "live", "--out", output, "--actor", actor, ...args], {
    cwd, env: { ...process.env, TEMP: "D:/tmp", TMP: "D:/tmp",
      CONTEXT_INLINE_SPILL_API_KEY: "agent-mocked-credential", CONTEXT_INLINE_SPILL_MODEL: "space-bunny",
      CONTEXT_INLINE_SPILL_BASE_URL: "http://127.0.0.1:3065/v1" },
    windowsHide: true, encoding: "utf8", timeout: 60_000,
  });
}
function runDirectory(output: string) { return join(output, readdirSync(output)[0]!); }

describe("benefit eval clean-candidate evidence", () => {
  it("rejects a changed output budget before any provider call", () => {
    const output = mkdtempSync(join(tmpdir(), "g7-budget-rejection-"));
    const child = execute(output, ["--freeze", freeze, "--max-output-tokens", "901"]);
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status).toBe(1);
    const rejection = JSON.parse(readFileSync(join(runDirectory(output), "preflight-rejected.json"), "utf8"));
    expect(rejection.providerRequests).toBe(0);
    expect(rejection.error).toContain("frozen output budget changed");
    expect(rejection.realHumanEvidence).toBe(false);
  }, 75_000);

  it("reads and rejects an actually dirty temporary Git candidate before a request", () => {
    const candidate = mkdtempSync(join(tmpdir(), "g7-dirty-candidate-"));
    expect(spawnSync("git", ["init", candidate], { windowsHide: true }).status).toBe(0);
    expect(spawnSync("git", ["-C", candidate, "-c", "user.name=agent", "-c", "user.email=agent@example.invalid",
      "commit", "--allow-empty", "-m", "agent-driven test candidate"], { windowsHide: true }).status).toBe(0);
    writeFileSync(join(candidate, "uncommitted.txt"), "agent-driven pending edit\n");
    const output = mkdtempSync(join(tmpdir(), "g7-dirty-output-"));
    const child = execute(output, ["--freeze", freeze], candidate);
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status).toBe(1);
    const rejection = JSON.parse(readFileSync(join(runDirectory(output), "preflight-rejected.json"), "utf8"));
    expect(rejection.candidate.dirty).toBe(true);
    expect(rejection.candidate.status).toContain("uncommitted.txt");
    expect(rejection.providerRequests).toBe(0);
    expect(rejection.error).toContain("clean committed candidate required");
  }, 75_000);

  it("retains incomplete usage and fails without retrying or accepting its final text", () => {
    const temp = mkdtempSync(join(tmpdir(), "g7-incomplete-"));
    const preload = join(temp, "provider.mjs");
    writeFileSync(preload, `globalThis.fetch = async () => new Response(JSON.stringify({
      status: "incomplete", model: "space-bunny", output: [], output_text: '{"value":null}',
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 11, output_tokens: 900, total_tokens: 911 }
    }), { status: 200 });\n`);
    const output = join(temp, "runs");
    const child = execute(output, ["--repeats", "1", "--max-turns", "8"], root, preload);
    expect(child.error, child.stderr).toBeUndefined();
    const dir = runDirectory(output);
    const records = JSON.parse(readFileSync(join(dir, "runs.json"), "utf8")).records;
    expect(records).toHaveLength(32);
    for (const record of records) {
      expect(record.success).toBe(false);
      expect(record.failureClass).toBe("provider_incomplete");
      expect(record.turns).toBe(1);
      expect(record.totalTokens).toBe(911);
      expect(record.finalAnswer).toEqual({ ok: false, value: null });
      expect(JSON.parse(record.providerCalls[0].raw_response).incomplete_details.reason).toBe("max_output_tokens");
    }
    expect(readFileSync(join(dir, "provider-calls.jsonl"), "utf8").trim().split("\n")).toHaveLength(32);
  }, 75_000);

  it("makes the verifier reject a dirty receipt even when other receipt fields say pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "g7-verifier-rejection-"));
    const metadata = { driven_by: "agent", actor, realHumanEvidence: false };
    writeFileSync(join(dir, "result.json"), JSON.stringify({ ...metadata, candidate: { dirty: true } }));
    writeFileSync(join(dir, "runs.json"), JSON.stringify({ ...metadata, records: [] }));
    writeFileSync(join(dir, "preflight.json"), JSON.stringify({ ...metadata, candidate: { dirty: true } }));
    writeFileSync(join(dir, "postflight.json"), JSON.stringify({ ...metadata, sameCandidate: true }));
    const out = join(dir, "verification.json");
    const child = spawnSync(process.execPath, [resolve("scripts/context-inline-spill-benefit-round6-verify.mjs"), dir, out],
      { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    expect(child.status).toBe(1);
    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.B7CleanCandidate).toBe(false);
    expect(report.verifierAcceptedCleanCandidate).toBe(false);
    expect(report.decision.verdict).toBe("NO_GO");
    expect(report.error).toContain("dirty candidate rejected");
  });
});
