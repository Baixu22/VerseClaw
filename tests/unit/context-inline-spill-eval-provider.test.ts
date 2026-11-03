// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("retains raw HTTP response and usage when a provider answer is not JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "inline-spill-provider-"));
  try {
    const preload = join(root, "provider.mjs");
    const body = {
      output_text: "not JSON",
      usage: { input_tokens: 13, output_tokens: 7, total_tokens: 20 },
    };
    writeFileSync(
      preload,
      `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(body))}, { status: 200 });\n`,
    );
    const output = join(root, "evals");
    const child = spawnSync(
      process.execPath,
      [
        resolve("openclaw_runtime/node_modules/tsx/dist/cli.mjs"),
        "--expose-gc",
        "--import",
        pathToFileURL(preload).href,
        "scripts/context-inline-spill-eval.mts",
        "--mode",
        "live",
        "--out",
        output,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CONTEXT_INLINE_SPILL_BASE_URL: "http://127.0.0.1:1/v1/responses",
          CONTEXT_INLINE_SPILL_MODEL: "agent-mocked-provider",
          CONTEXT_INLINE_SPILL_API_KEY: "agent-test-credential",
        },
        windowsHide: true,
        timeout: 45_000,
        encoding: "utf8",
      },
    );
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(1);
    expect(existsSync(output), child.stderr).toBe(true);
    const run = join(output, readdirSync(output)[0]!);
    const result = JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
    expect(result.decision.liveStatus).toBe("failed");
    expect(result.arms).toHaveLength(4);
    for (const arm of result.arms) {
      expect(arm.live.failure_class).toBe("provider_answer_json_invalid");
      expect(arm.live.http_status).toBe(200);
      expect(JSON.parse(arm.live.raw_response)).toEqual(body);
      expect(arm.live.usage).toEqual(body.usage);
      expect(arm.actual_total_tokens).toBe(20);
    }
    const transcript = JSON.parse(readFileSync(join(run, "transcript.json"), "utf8"));
    expect(
      transcript.arms.every(
        (arm: { provider_result: { raw_response?: string } }) =>
          arm.provider_result.raw_response === JSON.stringify(body),
      ),
    ).toBe(true);
    expect(JSON.parse(readFileSync(join(run, "credential-scan.json"), "utf8")).hits).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
