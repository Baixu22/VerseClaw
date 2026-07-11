import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyRecoveryManifest,
  classifyTrackedFile,
  findInvalidUtf8Ranges,
  scanTrackedFiles,
} from "./runtime-utf8-inventory.mjs";

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createGitFixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-utf8-test-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  runGit(repoRoot, ["init", "--quiet"]);
  runGit(repoRoot, ["config", "user.email", "test@example.com"]);
  runGit(repoRoot, ["config", "user.name", "Runtime UTF-8 Test"]);
  return repoRoot;
}

test("reports the full malformed UTF-8 unit at a deterministic byte offset", () => {
  const bytes = Buffer.from([0x61, 0xe2, 0x86, 0x3f, 0x62]);

  assert.deepEqual(findInvalidUtf8Ranges(bytes), [
    {
      offset: 1,
      length: 3,
      bytesHex: "e2863f",
      reason: "invalid-continuation",
    },
  ]);
});

test("accepts canonical UTF-8 across all supported sequence lengths", () => {
  assert.deepEqual(findInvalidUtf8Ranges(Buffer.from("A\u00a2\u20ac\u{10348}")), []);
});

test("rejects overlong, surrogate, out-of-range, and truncated sequences", () => {
  const cases = [
    {
      bytes: [0xe0, 0x80, 0x80],
      reason: "invalid-code-point",
      length: 3,
    },
    {
      bytes: [0xed, 0xa0, 0x80],
      reason: "invalid-code-point",
      length: 3,
    },
    {
      bytes: [0xf4, 0x90, 0x80, 0x80],
      reason: "invalid-code-point",
      length: 4,
    },
    {
      bytes: [0xe2, 0x82],
      reason: "truncated-sequence",
      length: 2,
    },
  ];

  for (const entry of cases) {
    assert.deepEqual(findInvalidUtf8Ranges(Buffer.from(entry.bytes)), [
      {
        offset: 0,
        length: entry.length,
        bytesHex: Buffer.from(entry.bytes).toString("hex"),
        reason: entry.reason,
      },
    ]);
  }
});

test("classifies tracked source text without hiding malformed UTF-8", () => {
  assert.equal(classifyTrackedFile("src/example.ts", Buffer.from([0xe2, 0x86, 0x3f])), "text");
  assert.equal(classifyTrackedFile("fixtures/unknown", Buffer.from("plain text")), "text");
});

test("classifies explicit binary formats and NUL-bearing unknown files as binary", () => {
  assert.equal(classifyTrackedFile("assets/image.png", Buffer.from("not a real png")), "binary");
  assert.equal(
    classifyTrackedFile("fixtures/data.unknown", Buffer.from([0x61, 0x00, 0x62])),
    "binary",
  );
});

test("scans tracked files with Git preimage identity and byte context", (t) => {
  const repoRoot = createGitFixture(t);
  const sourceDir = path.join(repoRoot, "runtime", "src");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, "broken.ts"),
    Buffer.from([0x61, 0x0a, 0xe2, 0x86, 0x3f, 0x62]),
  );
  fs.writeFileSync(path.join(sourceDir, "valid.ts"), "export {};\n");
  fs.writeFileSync(path.join(sourceDir, "image.png"), Buffer.from([0x89, 0x00]));
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["commit", "--quiet", "-m", "fixture"]);

  const manifest = scanTrackedFiles({
    repoRoot,
    pathspec: "runtime",
    contextBytes: 2,
  });

  assert.deepEqual(manifest.summary, {
    trackedFiles: 3,
    textFiles: 2,
    binaryFiles: 1,
    invalidFiles: 1,
    invalidUnits: 1,
    worktreeMismatches: 0,
  });
  assert.equal(manifest.files.length, 1);
  assert.match(manifest.files[0].gitBlobOid, /^[0-9a-f]{40}$/);
  assert.equal(manifest.files[0].worktreeMatchesGit, true);
  assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.files[0].invalidRanges, [
    {
      offset: 2,
      length: 3,
      bytesHex: "e2863f",
      reason: "invalid-continuation",
      contextStart: 0,
      contextHex: "610ae2863f62",
    },
  ]);

  fs.writeFileSync(path.join(sourceDir, "valid.ts"), "export const changed = true;\n");
  const changedManifest = scanTrackedFiles({ repoRoot, pathspec: "runtime" });
  assert.equal(changedManifest.summary.worktreeMismatches, 1);
});

test("uses Git blob bytes and clean-filter identity on a CRLF checkout", (t) => {
  const repoRoot = createGitFixture(t);
  runGit(repoRoot, ["config", "core.autocrlf", "true"]);
  const runtimeDir = path.join(repoRoot, "runtime");
  fs.mkdirSync(runtimeDir);
  fs.writeFileSync(
    path.join(runtimeDir, "broken.ts"),
    Buffer.from([0x61, 0x0d, 0x0a, 0xe2, 0x86, 0x3f]),
  );
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["commit", "--quiet", "-m", "fixture"]);

  const manifest = scanTrackedFiles({ repoRoot, pathspec: "runtime" });

  assert.equal(manifest.summary.worktreeMismatches, 0);
  assert.equal(manifest.files[0].invalidRanges[0].offset, 2);
  assert.equal(manifest.files[0].invalidRanges[0].contextHex, "610ae2863f");
});

test("rejects unresolved recovery entries before writing any file", (t) => {
  const repoRoot = createGitFixture(t);
  const filePath = path.join(repoRoot, "broken.ts");
  const original = Buffer.from([0xe2, 0x86, 0x3f]);
  fs.writeFileSync(filePath, original);

  assert.throws(
    () =>
      applyRecoveryManifest({
        repoRoot,
        manifest: {
          schemaVersion: 1,
          repairs: [
            {
              path: "broken.ts",
              preimageSha256: "0".repeat(64),
              confidence: "unresolved",
              replacements: [],
            },
          ],
        },
      }),
    /unresolved/,
  );
  assert.deepEqual(fs.readFileSync(filePath), original);
});

test("rejects a changed preimage before applying an exact repair", (t) => {
  const repoRoot = createGitFixture(t);
  const filePath = path.join(repoRoot, "broken.ts");
  const original = Buffer.from([0xe2, 0x86, 0x3f]);
  fs.writeFileSync(filePath, original);

  assert.throws(
    () =>
      applyRecoveryManifest({
        repoRoot,
        manifest: {
          schemaVersion: 1,
          repairs: [
            {
              path: "broken.ts",
              preimageSha256: "f".repeat(64),
              confidence: "exact",
              replacements: [
                {
                  offset: 0,
                  removeHex: "e2863f",
                  insertHex: "e28692",
                  evidenceIds: ["upstream:e993"],
                },
              ],
            },
          ],
        },
      }),
    /preimage SHA-256 mismatch/,
  );
  assert.deepEqual(fs.readFileSync(filePath), original);
});

test("applies a hash-guarded exact repair and reports postimage evidence", (t) => {
  const repoRoot = createGitFixture(t);
  const filePath = path.join(repoRoot, "broken.ts");
  const original = Buffer.from([0x61, 0xe2, 0x86, 0x3f, 0x62]);
  fs.writeFileSync(filePath, original);
  const preimageSha256 = createHash("sha256").update(original).digest("hex");

  const results = applyRecoveryManifest({
    repoRoot,
    manifest: {
      schemaVersion: 1,
      repairs: [
        {
          path: "broken.ts",
          preimageSha256,
          confidence: "exact",
          replacements: [
            {
              offset: 1,
              removeHex: "e2863f",
              insertHex: "e28692",
              evidenceIds: ["upstream:e993"],
            },
          ],
        },
      ],
    },
  });

  assert.equal(fs.readFileSync(filePath, "utf8"), "a\u2192b");
  assert.equal(results.length, 1);
  assert.equal(results[0].path, "broken.ts");
  assert.equal(results[0].preimageSha256, preimageSha256);
  assert.match(results[0].postimageSha256, /^[0-9a-f]{64}$/);
});

test("CLI writes inventory evidence and exits nonzero while invalid UTF-8 remains", (t) => {
  const repoRoot = createGitFixture(t);
  const runtimeDir = path.join(repoRoot, "runtime");
  const outputPath = path.join(repoRoot, "inventory.json");
  fs.mkdirSync(runtimeDir);
  fs.writeFileSync(path.join(runtimeDir, "broken.ts"), Buffer.from([0xe2, 0x86, 0x3f]));
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["commit", "--quiet", "-m", "fixture"]);
  const scriptPath = fileURLToPath(new URL("./runtime-utf8-inventory.mjs", import.meta.url));

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--root", repoRoot, "--pathspec", "runtime", "--output", outputPath],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /invalidFiles=1 invalidUnits=1/);
  const manifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(manifest.summary.invalidUnits, 1);
});
