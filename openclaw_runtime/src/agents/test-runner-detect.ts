/**
 * FP-P1-04 verify segment: project test-runner DETECTION.
 *
 * The coding loop's verify段 must either run the project's tests or say, in
 * words, why it did not. Before this module there was no detection at all, so
 * "no test runner" and "tests passed" were indistinguishable — exactly the
 * silent-degradation the task doc forbids.
 *
 * This module only DETECTS and builds the command. It never executes: running
 * belongs to the exec/bash tool so it inherits the existing approval, sandbox
 * and timeout policy rather than growing a second execution path.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Why no runnable test command could be produced. */
export type TestRunnerSkipReason =
  | "no-workspace"
  | "no-manifest"
  | "no-test-script"
  | "placeholder-test-script"
  | "unsupported-ecosystem";

export type TestRunnerDetection =
  | {
      detected: true;
      /** Ecosystem id, e.g. `node`, `python`, `rust`, `go`. */
      ecosystem: string;
      /** Package manager / driver, e.g. `pnpm`, `npm`, `pytest`, `cargo`. */
      runner: string;
      /** Shell command the agent should run via the exec tool. */
      command: string;
      /** File that proved the runner exists, relative to the workspace root. */
      evidence: string;
    }
  | {
      detected: false;
      skipReason: TestRunnerSkipReason;
      /** Human-readable reason surfaced to the model and the user. */
      message: string;
    };

/**
 * npm init writes this as the default `scripts.test`. Treating it as a real
 * runner would make verify report a hard failure on every untested project.
 */
const PLACEHOLDER_TEST_SCRIPT = /no test specified/i;

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Pick the package manager from the lockfile so the command matches the repo. */
function nodePackageManager(workspaceRoot: string): { runner: string; evidence: string } {
  if (existsSync(path.join(workspaceRoot, "pnpm-lock.yaml"))) {
    return { runner: "pnpm", evidence: "pnpm-lock.yaml" };
  }
  if (existsSync(path.join(workspaceRoot, "yarn.lock"))) {
    return { runner: "yarn", evidence: "yarn.lock" };
  }
  if (existsSync(path.join(workspaceRoot, "bun.lockb"))) {
    return { runner: "bun", evidence: "bun.lockb" };
  }
  return { runner: "npm", evidence: "package.json" };
}

function detectNode(workspaceRoot: string): TestRunnerDetection | null {
  const manifestPath = path.join(workspaceRoot, "package.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const manifest = readJsonFile(manifestPath);
  const scripts =
    manifest?.scripts && typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts)
      ? (manifest.scripts as Record<string, unknown>)
      : null;
  const testScript = typeof scripts?.test === "string" ? scripts.test : null;
  if (!testScript || testScript.trim().length === 0) {
    return {
      detected: false,
      skipReason: "no-test-script",
      message:
        "package.json has no `scripts.test`; no project test suite was run. Add a test script or run the suite manually.",
    };
  }
  if (PLACEHOLDER_TEST_SCRIPT.test(testScript)) {
    return {
      detected: false,
      skipReason: "placeholder-test-script",
      message:
        'package.json `scripts.test` is the npm placeholder ("no test specified"); no project test suite was run.',
    };
  }
  const { runner, evidence } = nodePackageManager(workspaceRoot);
  return {
    detected: true,
    ecosystem: "node",
    runner,
    command: runner === "npm" ? "npm test" : `${runner} test`,
    evidence,
  };
}

function detectPython(workspaceRoot: string): TestRunnerDetection | null {
  for (const marker of ["pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml"]) {
    const file = path.join(workspaceRoot, marker);
    if (!existsSync(file)) {
      continue;
    }
    // pyproject/setup.cfg only count when they actually mention pytest.
    if (marker === "pyproject.toml" || marker === "setup.cfg" || marker === "tox.ini") {
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!/pytest/i.test(text)) {
        continue;
      }
    }
    return {
      detected: true,
      ecosystem: "python",
      runner: "pytest",
      command: "pytest -q",
      evidence: marker,
    };
  }
  return null;
}

function detectRust(workspaceRoot: string): TestRunnerDetection | null {
  return existsSync(path.join(workspaceRoot, "Cargo.toml"))
    ? {
        detected: true,
        ecosystem: "rust",
        runner: "cargo",
        command: "cargo test",
        evidence: "Cargo.toml",
      }
    : null;
}

function detectGo(workspaceRoot: string): TestRunnerDetection | null {
  return existsSync(path.join(workspaceRoot, "go.mod"))
    ? {
        detected: true,
        ecosystem: "go",
        runner: "go",
        command: "go test ./...",
        evidence: "go.mod",
      }
    : null;
}

/**
 * Detect the project's test runner. Never throws; an undetectable project is a
 * reported skip with a reason, never a silent pass.
 */
export function detectTestRunner(workspaceRoot: string | undefined): TestRunnerDetection {
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    return {
      detected: false,
      skipReason: "no-workspace",
      message: "No workspace root is bound to this session; test detection was skipped.",
    };
  }
  // Node is checked first and may return a *negative* result (manifest exists
  // but declares no usable test script) — that is more specific than falling
  // through to another ecosystem, so it is returned as-is.
  const node = detectNode(workspaceRoot);
  if (node) {
    return node;
  }
  for (const detect of [detectPython, detectRust, detectGo]) {
    const hit = detect(workspaceRoot);
    if (hit) {
      return hit;
    }
  }
  const anyManifest = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"].some((name) =>
    existsSync(path.join(workspaceRoot, name)),
  );
  return anyManifest
    ? {
        detected: false,
        skipReason: "unsupported-ecosystem",
        message:
          "A project manifest exists but no supported test runner (node/pytest/cargo/go) was recognized; no test suite was run.",
      }
    : {
        detected: false,
        skipReason: "no-manifest",
        message:
          "No project manifest (package.json / pyproject.toml / Cargo.toml / go.mod) was found in the workspace root; no test suite was run.",
      };
}

/** One-line rendering used in tool result details and session-visible output. */
export function formatTestRunnerDetection(detection: TestRunnerDetection): string {
  return detection.detected
    ? `detected(${detection.ecosystem}/${detection.runner}): ${detection.command} [via ${detection.evidence}]`
    : `skipped(${detection.skipReason}): ${detection.message}`;
}
