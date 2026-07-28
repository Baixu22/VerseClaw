import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectTestRunner,
  formatTestRunnerDetection,
  type TestRunnerDetection,
} from "./test-runner-detect.js";

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "fp-p1-04-detect-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

function expectDetected(
  detection: TestRunnerDetection,
): Extract<TestRunnerDetection, { detected: true }> {
  if (!detection.detected) {
    throw new Error(`expected a detected runner, got skip: ${detection.skipReason}`);
  }
  return detection;
}

describe("FP-P1-04 test-runner detection (verify segment)", () => {
  const cleanup: string[] = [];
  const ws = (files: Record<string, string>): string => {
    const root = makeWorkspace(files);
    cleanup.push(root);
    return root;
  };
  afterAll(() => {
    for (const dir of cleanup) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects the node runner and matches the command to the lockfile", () => {
    const pnpmRoot = ws({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
    });
    const pnpm = expectDetected(detectTestRunner(pnpmRoot));
    expect(pnpm.ecosystem).toBe("node");
    expect(pnpm.runner).toBe("pnpm");
    expect(pnpm.command).toBe("pnpm test");
    expect(pnpm.evidence).toBe("pnpm-lock.yaml");

    const npmRoot = ws({ "package.json": JSON.stringify({ scripts: { test: "jest" } }) });
    const npm = expectDetected(detectTestRunner(npmRoot));
    expect(npm.runner).toBe("npm");
    expect(npm.command).toBe("npm test");

    const yarnRoot = ws({
      "package.json": JSON.stringify({ scripts: { test: "jest" } }),
      "yarn.lock": "# yarn\n",
    });
    expect(expectDetected(detectTestRunner(yarnRoot)).command).toBe("yarn test");
  });

  it("detects pytest / cargo / go", () => {
    const py = expectDetected(detectTestRunner(ws({ "pytest.ini": "[pytest]\n" })));
    expect(py.runner).toBe("pytest");
    expect(py.command).toBe("pytest -q");

    const rust = expectDetected(detectTestRunner(ws({ "Cargo.toml": "[package]\nname=\"x\"\n" })));
    expect(rust.command).toBe("cargo test");

    const go = expectDetected(detectTestRunner(ws({ "go.mod": "module x\n" })));
    expect(go.command).toBe("go test ./...");
  });

  it("only counts pyproject/setup.cfg when they actually mention pytest", () => {
    const withoutPytest = detectTestRunner(ws({ "pyproject.toml": "[project]\nname = 'x'\n" }));
    expect(withoutPytest.detected).toBe(false);
    // A manifest exists but no runner was recognized — that is a DIFFERENT and
    // more informative reason than "no manifest at all".
    expect(withoutPytest.detected === false && withoutPytest.skipReason).toBe(
      "unsupported-ecosystem",
    );

    const withPytest = detectTestRunner(
      ws({ "pyproject.toml": "[tool.pytest.ini_options]\naddopts = '-q'\n" }),
    );
    expect(expectDetected(withPytest).runner).toBe("pytest");
  });

  describe("skips are explainable, never silent", () => {
    it("reports no-workspace", () => {
      for (const value of [undefined, "", "   "]) {
        const detection = detectTestRunner(value);
        expect(detection.detected).toBe(false);
        expect(detection.detected === false && detection.skipReason).toBe("no-workspace");
      }
    });

    it("reports no-manifest for an empty workspace", () => {
      const detection = detectTestRunner(ws({ "README.md": "# hi\n" }));
      expect(detection.detected).toBe(false);
      expect(detection.detected === false && detection.skipReason).toBe("no-manifest");
    });

    it("reports no-test-script when package.json declares none", () => {
      const detection = detectTestRunner(
        ws({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) }),
      );
      expect(detection.detected).toBe(false);
      expect(detection.detected === false && detection.skipReason).toBe("no-test-script");
      expect(detection.detected === false && detection.message).toMatch(/scripts\.test/);
    });

    it("does not mistake the npm placeholder script for a real runner", () => {
      const detection = detectTestRunner(
        ws({
          "package.json": JSON.stringify({
            scripts: { test: 'echo "Error: no test specified" && exit 1' },
          }),
        }),
      );
      expect(detection.detected).toBe(false);
      expect(detection.detected === false && detection.skipReason).toBe("placeholder-test-script");
    });

    it("treats an unreadable/corrupt manifest as no-test-script, not a crash", () => {
      const detection = detectTestRunner(ws({ "package.json": "{ not json" }));
      expect(detection.detected).toBe(false);
      expect(detection.detected === false && detection.skipReason).toBe("no-test-script");
    });

    it("every skip carries a non-empty human-readable message", () => {
      const skips = [
        detectTestRunner(undefined),
        detectTestRunner(ws({ "README.md": "x" })),
        detectTestRunner(ws({ "package.json": JSON.stringify({ scripts: {} }) })),
      ];
      for (const detection of skips) {
        expect(detection.detected).toBe(false);
        expect(detection.detected === false && detection.message.length).toBeGreaterThan(20);
      }
    });
  });

  it("renders both outcomes distinguishably", () => {
    const detected = formatTestRunnerDetection(
      detectTestRunner(ws({ "package.json": JSON.stringify({ scripts: { test: "vitest" } }) })),
    );
    expect(detected).toMatch(/^detected\(node\/npm\): npm test/);

    const skipped = formatTestRunnerDetection(detectTestRunner(ws({ "README.md": "x" })));
    expect(skipped).toMatch(/^skipped\(no-manifest\):/);
    // The key property: a skip can never be read as a pass.
    expect(skipped).not.toMatch(/^detected/);
  });

  it("node's negative verdict wins over a sibling ecosystem manifest", () => {
    // package.json without a test script + a Cargo.toml present: reporting
    // "cargo test" would run the wrong suite for a node project.
    const detection = detectTestRunner(
      ws({
        "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
        "Cargo.toml": "[package]\nname=\"x\"\n",
      }),
    );
    expect(detection.detected).toBe(false);
    expect(detection.detected === false && detection.skipReason).toBe("no-test-script");
  });
});
