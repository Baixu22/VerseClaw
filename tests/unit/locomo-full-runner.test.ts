// @vitest-environment node
// CLI orchestration only: the child and verifier below are synthetic, never model evidence.
import { mkdtempSync, writeFileSync, rmSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("initializes the verifier after CLI model options, not at module load", () => {
  const dir = mkdtempSync(join(tmpdir(), "locomo-cli-config-"));
  const preload = join(dir, "synthetic-preload.mjs");
  const output = join(dir, "output");
  writeFileSync(preload, `
    import childProcess from 'node:child_process';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = (_command, _args, options) => {
      if (options.env.RUNTIME_MEMORY_LLM_MODEL !== 'step-5-preview' || options.env.FULL_EVAL !== '1') throw Error('Wrong child configuration');
      return { status: 0 };
    };
    syncBuiltinESMExports();
    registerHooks({ load(url, context, next) {
      if (url.endsWith('/scripts/check-locomo-evidence.mjs')) return { format: 'module', shortCircuit: true, source: \`const capturedModel = process.env.RUNTIME_MEMORY_LLM_MODEL; export function verifyLocomoEvidenceFile() { if (capturedModel !== 'step-5-preview') throw Error('Verifier captured stale model'); return { synthetic: true, capturedModel }; }\` };
      if (url.endsWith('/tests/unit/helpers/locomo-embedding-provider.ts')) return { format: 'module', shortCircuit: true, source: 'export async function verifyLocomoEmbeddingResources() {}' };
      return next(url, context);
    }});
  `);
  try {
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, "scripts/run-locomo-full-evaluation.mjs", "--base-url", "https://synthetic.invalid/v1", "--model", "step-5-preview", "--output-dir", output], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      env: { ...process.env, RUNTIME_MEMORY_LLM_MODEL: "", DEEPSEEK_MODEL: "", RUNTIME_MEMORY_LLM_API_KEY: "synthetic-not-a-credential" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ synthetic: true, capturedModel: "step-5-preview" });
    expect(result.stdout + result.stderr).not.toContain("synthetic-not-a-credential");
  } finally {
    rmSync(preload);
    if (existsSync(output)) rmdirSync(output);
    rmdirSync(dir);
  }
});
