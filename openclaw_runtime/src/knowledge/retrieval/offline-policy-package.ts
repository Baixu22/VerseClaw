import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveOpenClawPackageRoot } from "../../infra/openclaw-root.js";
import type {
  OfflineRetrievalEvaluationV1,
  RetrievalPolicyV1,
} from "../../../../shared/knowledge/observability.js";

/** Run the packaged grader in a bounded Node process, outside the Gateway event loop. */
export async function verifyOfflineRagPolicyPackage(
  directory: string,
  expectedManifestDigest: string,
  options: { runtimeRoot?: string; manifestName?: string } = {},
): Promise<{
  candidate: RetrievalPolicyV1;
  expectedPolicyDigest: string;
  evaluation: OfflineRetrievalEvaluationV1;
  evidenceRoot: string;
  evidenceManifestDigest: string;
}> {
  if (
    typeof directory !== "string" ||
    !directory ||
    directory.length > 4096 ||
    /[\r\n\0]/.test(directory) ||
    !/^sha256:[a-f0-9]{64}$/.test(expectedManifestDigest)
  )
    throw new Error("Pinned original evaluation package required");
  const name = options.manifestName ?? "policy-package.json";
  if (!name || name.length > 255 || basename(name) !== name || /[\\/\r\n\0]/.test(name))
    throw new Error("Invalid offline policy manifest name");
  const runtimeRoot =
    options.runtimeRoot ?? (await resolveOpenClawPackageRoot({ moduleUrl: import.meta.url }));
  if (!runtimeRoot) throw new Error("Offline policy verifier runtime is unavailable");
  const entry = join(runtimeRoot, "dist", "project-rag-policy-verifier.mjs");
  const provenance = JSON.parse(
    await readFile(join(runtimeRoot, "dist", "project-rag-policy-verifier.json"), "utf8"),
  );
  if (
    provenance.schema !== "ProjectRagPolicyVerifier/v1" ||
    provenance.cleanSource !== true ||
    !/^[a-f0-9]{40}$/.test(provenance.candidate) ||
    provenance.sha256 !==
      createHash("sha256")
        .update(await readFile(entry))
        .digest("hex")
  )
    throw new Error("Offline policy verifier artifact changed");
  let executable = process.execPath;
  if (process.versions.electron) {
    const resources = (process as typeof process & { resourcesPath?: string }).resourcesPath;
    const binary = process.platform === "win32" ? "node.exe" : "node";
    const delivered = resources && join(resources, "bin");
    const nodeRoot =
      delivered && existsSync(join(delivered, "node-runtime.json"))
        ? delivered
        : join(runtimeRoot, "..", "resources", "bin", `${process.platform}-${process.arch}`);
    executable = join(nodeRoot, binary);
    const receipt = JSON.parse(await readFile(join(nodeRoot, "node-runtime.json"), "utf8"));
    if (
      receipt.target !== `${process.platform}-${process.arch}` ||
      receipt.sha256 !==
        createHash("sha256")
          .update(await readFile(executable))
          .digest("hex")
    )
      throw new Error("Bundled Node runtime changed");
  }
  const env: NodeJS.ProcessEnv = {
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  };
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      executable,
      ["--max-old-space-size=512", entry, directory, expectedManifestDigest, name],
      {
        cwd: runtimeRoot,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      errorOutput = "",
      bytes = 0,
      failure: Error | undefined,
      settled = false;
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        if (child.exitCode === null)
          spawnSync(
            join(process.env.SystemRoot || "C:/Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 5000, stdio: "ignore" },
          );
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(hardStop);
      if (error) reject(error);
      else resolve(output);
    };
    const deadline = setTimeout(() => {
      failure = new Error("Offline policy verifier deadline expired");
      terminate();
    }, 120_000);
    const hardStop = setTimeout(() => {
      terminate();
      finish(failure ?? new Error("Offline verifier termination was not confirmed"));
    }, 130_000);
    const capture = (chunk: string, stderr: boolean) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > 256 * 1024) {
        failure = new Error("Offline policy verifier output budget exceeded");
        terminate();
        return;
      }
      if (stderr) errorOutput += chunk;
      else output += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => capture(chunk, false));
    child.stderr.setEncoding("utf8").on("data", (chunk) => capture(chunk, true));
    child.once("error", (error) => finish(error));
    child.once("exit", () => {
      if (process.platform !== "win32") terminate();
    });
    child.once("close", (code) =>
      finish(
        failure ??
          (code === 0
            ? undefined
            : new Error(errorOutput.trim() || `Offline policy verifier exited ${code}`)),
      ),
    );
  });
  const verified = JSON.parse(stdout);
  if (
    !verified ||
    verified.evidenceManifestDigest !== expectedManifestDigest ||
    verified.evaluation?.schema !== "OfflineRetrievalEvaluation/v1" ||
    verified.evaluation.candidateCommit !== provenance.candidate
  )
    throw new Error("Offline policy verifier returned invalid evidence");
  return verified;
}
