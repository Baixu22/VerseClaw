import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".conf",
  ".css",
  ".csv",
  ".env",
  ".fish",
  ".gql",
  ".graphql",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".json5",
  ".jsx",
  ".lock",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".properties",
  ".proto",
  ".ps1",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".bin",
  ".bmp",
  ".br",
  ".bz2",
  ".class",
  ".dat",
  ".dll",
  ".dylib",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".node",
  ".otf",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".tgz",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xz",
  ".zip",
]);

const TEXT_BASENAMES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  "dockerfile",
  "license",
  "makefile",
  "readme",
]);

function isContinuation(byte) {
  return (byte & 0xc0) === 0x80;
}

function sequenceShape(lead) {
  if (lead >= 0xc2 && lead <= 0xdf) {
    return { length: 2, secondMin: 0x80, secondMax: 0xbf };
  }
  if (lead === 0xe0) {
    return { length: 3, secondMin: 0xa0, secondMax: 0xbf };
  }
  if ((lead >= 0xe1 && lead <= 0xec) || (lead >= 0xee && lead <= 0xef)) {
    return { length: 3, secondMin: 0x80, secondMax: 0xbf };
  }
  if (lead === 0xed) {
    return { length: 3, secondMin: 0x80, secondMax: 0x9f };
  }
  if (lead === 0xf0) {
    return { length: 4, secondMin: 0x90, secondMax: 0xbf };
  }
  if (lead >= 0xf1 && lead <= 0xf3) {
    return { length: 4, secondMin: 0x80, secondMax: 0xbf };
  }
  if (lead === 0xf4) {
    return { length: 4, secondMin: 0x80, secondMax: 0x8f };
  }
  return undefined;
}

function invalidRange(bytes, offset, length, reason) {
  const unit = bytes.subarray(offset, offset + length);
  return {
    offset,
    length: unit.length,
    bytesHex: unit.toString("hex"),
    reason,
  };
}

export function findInvalidUtf8Ranges(bytes) {
  const ranges = [];

  for (let offset = 0; offset < bytes.length; ) {
    const lead = bytes[offset];
    if (lead <= 0x7f) {
      offset += 1;
      continue;
    }

    const shape = sequenceShape(lead);
    if (!shape) {
      ranges.push(invalidRange(bytes, offset, 1, "invalid-leading-byte"));
      offset += 1;
      continue;
    }

    const remaining = bytes.length - offset;
    if (remaining < shape.length) {
      ranges.push(invalidRange(bytes, offset, remaining, "truncated-sequence"));
      break;
    }

    const unit = bytes.subarray(offset, offset + shape.length);
    const continuationsValid = unit.subarray(1).every(isContinuation);
    if (!continuationsValid) {
      ranges.push(invalidRange(bytes, offset, shape.length, "invalid-continuation"));
      offset += shape.length;
      continue;
    }

    if (unit[1] < shape.secondMin || unit[1] > shape.secondMax) {
      ranges.push(invalidRange(bytes, offset, shape.length, "invalid-code-point"));
      offset += shape.length;
      continue;
    }

    offset += shape.length;
  }

  return ranges;
}

export function classifyTrackedFile(filePath, bytes) {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const extension = path.posix.extname(normalized);
  const basename = path.posix.basename(normalized);

  if (BINARY_EXTENSIONS.has(extension)) {
    return "binary";
  }
  if (TEXT_EXTENSIONS.has(extension) || TEXT_BASENAMES.has(basename)) {
    return "text";
  }
  if (bytes.includes(0)) {
    return "binary";
  }
  return "text";
}

export function findReplacementCharacterLines(bytes) {
  const lines = bytes.toString("utf8").split(/\r\n|\n|\r/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const count = [...lines[index]].filter((character) => character === "\uFFFD").length;
    if (count > 0) {
      matches.push({ line: index + 1, count });
    }
  }
  return matches;
}

function globToRegExp(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function prepareReplacementAllowlist(allowlist) {
  if (!allowlist) {
    return [];
  }
  if (allowlist.schemaVersion !== 1 || !Array.isArray(allowlist.entries)) {
    throw new Error("invalid U+FFFD allowlist");
  }
  return allowlist.entries.map((entry, index) => {
    if (
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      (entry.line !== "*" && (!Number.isInteger(entry.line) || entry.line < 1)) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length === 0 ||
      typeof entry.test !== "string" ||
      entry.test.trim().length === 0
    ) {
      throw new Error(`invalid U+FFFD allowlist entry at index ${index}`);
    }
    const expected = entry.expected;
    if (
      !expected ||
      !Number.isInteger(expected.files) ||
      expected.files < 1 ||
      !Number.isInteger(expected.lines) ||
      expected.lines < 1 ||
      !Number.isInteger(expected.units) ||
      expected.units < 1
    ) {
      throw new Error(`invalid U+FFFD allowlist expected counts at index ${index}`);
    }
    return {
      ...entry,
      index,
      pathMatcher: globToRegExp(entry.path.replaceAll("\\", "/")),
      matchedFiles: new Set(),
      matchedLines: new Set(),
      matchedUnits: 0,
    };
  });
}

function auditReplacementCharacters(files, allowlist) {
  const prepared = prepareReplacementAllowlist(allowlist);
  let totalUnits = 0;
  let allowedUnits = 0;
  const auditedFiles = files.map((file) => ({
    path: file.path,
    lines: file.lines.map((line) => {
      totalUnits += line.count;
      const matchingEntries = prepared.filter(
        (entry) =>
          entry.pathMatcher.test(file.path) && (entry.line === "*" || entry.line === line.line),
      );
      if (matchingEntries.length !== 1) {
        return {
          ...line,
          allowed: false,
          allowlistMatches: matchingEntries.map((entry) => entry.index),
        };
      }
      const [entry] = matchingEntries;
      entry.matchedFiles.add(file.path);
      entry.matchedLines.add(`${file.path}:${line.line}`);
      entry.matchedUnits += line.count;
      allowedUnits += line.count;
      return {
        ...line,
        allowed: true,
        allowlistEntry: entry.index,
      };
    }),
  }));
  const allowlistErrors = prepared.flatMap((entry) => {
    const actual = {
      files: entry.matchedFiles.size,
      lines: entry.matchedLines.size,
      units: entry.matchedUnits,
    };
    return actual.files === entry.expected.files &&
      actual.lines === entry.expected.lines &&
      actual.units === entry.expected.units
      ? []
      : [
          {
            entry: entry.index,
            path: entry.path,
            expected: entry.expected,
            actual,
          },
        ];
  });
  return {
    summary: {
      files: auditedFiles.length,
      lines: auditedFiles.reduce((total, file) => total + file.lines.length, 0),
      units: totalUnits,
      allowedUnits,
      unallowedUnits: totalUnits - allowedUnits,
      allowlistEntries: prepared.length,
      allowlistErrors: allowlistErrors.length,
    },
    files: auditedFiles,
    allowlistErrors,
  };
}

function gitOutput(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function listIndexEntries(repoRoot, pathspec) {
  const args = ["ls-files", "-s", "-z"];
  if (pathspec) {
    args.push("--", pathspec);
  }
  const output = execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("\t");
      const metadata = entry.slice(0, separator).split(" ");
      return {
        mode: metadata[0],
        oid: metadata[1],
        stage: metadata[2],
        path: entry.slice(separator + 1).replaceAll("\\", "/"),
      };
    })
    .filter((entry) => entry.stage === "0" && entry.mode !== "160000");
}

function hashBytes(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function hashGitBlob(bytes, objectFormat) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

function readGitBlobs(repoRoot, entries) {
  const input = `${entries.map((entry) => entry.oid).join("\n")}\n`;
  const output = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    encoding: null,
    input: Buffer.from(input, "ascii"),
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
  });
  const blobs = [];
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error(`missing cat-file header for ${entry.path}`);
    }
    const [oid, type, sizeText] = output.subarray(offset, headerEnd).toString("ascii").split(" ");
    const size = Number(sizeText);
    if (oid !== entry.oid || type !== "blob" || !Number.isSafeInteger(size)) {
      throw new Error(`invalid cat-file header for ${entry.path}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    blobs.push(output.subarray(contentStart, contentEnd));
    if (output[contentEnd] !== 0x0a) {
      throw new Error(`missing cat-file delimiter for ${entry.path}`);
    }
    offset = contentEnd + 1;
  }
  return blobs;
}

function hashWorktreeFiles(repoRoot, entries) {
  if (entries.some((entry) => entry.path.includes("\n"))) {
    throw new Error("tracked paths containing newlines are not supported");
  }
  const output = execFileSync("git", ["hash-object", "--stdin-paths"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${entries.map((entry) => entry.path).join("\n")}\n`,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const hashes = output.trim().split("\n");
  if (hashes.length !== entries.length) {
    throw new Error("hash-object returned an unexpected number of worktree hashes");
  }
  return hashes;
}

function withContext(bytes, range, contextBytes) {
  const contextStart = Math.max(0, range.offset - contextBytes);
  const contextEnd = Math.min(bytes.length, range.offset + range.length + contextBytes);
  return {
    ...range,
    contextStart,
    contextHex: bytes.subarray(contextStart, contextEnd).toString("hex"),
  };
}

export function scanTrackedFiles({
  repoRoot,
  pathspec,
  contextBytes = 16,
  replacementAllowlist,
}) {
  const objectFormat = gitOutput(repoRoot, ["rev-parse", "--show-object-format"]);
  const baseCommit = gitOutput(repoRoot, ["rev-parse", "HEAD"]);
  const entries = listIndexEntries(repoRoot, pathspec);
  const gitBlobs = readGitBlobs(repoRoot, entries);
  const worktreeOids = hashWorktreeFiles(repoRoot, entries);
  const files = [];
  const replacementFiles = [];
  const summary = {
    trackedFiles: entries.length,
    textFiles: 0,
    binaryFiles: 0,
    invalidFiles: 0,
    invalidUnits: 0,
    worktreeMismatches: 0,
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const bytes = gitBlobs[index];
    const verifiedGitOid = hashGitBlob(bytes, objectFormat);
    if (verifiedGitOid !== entry.oid) {
      throw new Error(`Git blob hash mismatch for ${entry.path}`);
    }
    const classification = classifyTrackedFile(entry.path, bytes);
    if (classification === "binary") {
      summary.binaryFiles += 1;
    } else {
      summary.textFiles += 1;
    }

    const worktreeOid = worktreeOids[index];
    const worktreeMatchesGit = worktreeOid === entry.oid;
    if (!worktreeMatchesGit) {
      summary.worktreeMismatches += 1;
    }

    if (classification === "binary") {
      continue;
    }

    const rawInvalidRanges = findInvalidUtf8Ranges(bytes);
    const invalidRanges = rawInvalidRanges.map((range) =>
      withContext(bytes, range, contextBytes),
    );
    if (rawInvalidRanges.length === 0) {
      const lines = findReplacementCharacterLines(bytes);
      if (lines.length > 0) {
        replacementFiles.push({ path: entry.path, lines });
      }
    }
    if (invalidRanges.length > 0) {
      summary.invalidFiles += 1;
      summary.invalidUnits += invalidRanges.length;
      files.push({
        path: entry.path,
        gitBlobOid: entry.oid,
        worktreeBlobOid: worktreeOid,
        worktreeMatchesGit,
        sha256: hashBytes(bytes),
        byteLength: bytes.length,
        invalidRanges,
      });
    }
  }

  return {
    schemaVersion: 1,
    baseCommit,
    objectFormat,
    pathspec: pathspec ?? null,
    summary,
    files,
    replacementCharacters: auditReplacementCharacters(replacementFiles, replacementAllowlist),
  };
}

function resolveRepairPath(repoRoot, relativePath) {
  const absoluteRoot = path.resolve(repoRoot);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`repair path escapes repository root: ${relativePath}`);
  }
  return absolutePath;
}

function decodeReplacementHex(value, label) {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error(`${label} must be an even-length hexadecimal string`);
  }
  return Buffer.from(value, "hex");
}

function requireSha256(value, label, repairPath) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash: ${repairPath}`);
  }
  return value.toLowerCase();
}

function readRepairPreimage(repoRoot, repair, preimageMode) {
  const absolutePath = resolveRepairPath(repoRoot, repair.path);
  if (preimageMode === "worktree") {
    return {
      absolutePath,
      original: fs.readFileSync(absolutePath),
    };
  }

  const indexOid = gitOutput(repoRoot, ["rev-parse", `:${repair.path}`]);
  const cleanedWorktreeOid = gitOutput(repoRoot, [
    "hash-object",
    `--path=${repair.path}`,
    repair.path,
  ]);
  if (cleanedWorktreeOid !== indexOid) {
    throw new Error(
      `worktree clean-filter identity mismatch for ${repair.path}: expected ${indexOid}, got ${cleanedWorktreeOid}`,
    );
  }
  const original = execFileSync("git", ["cat-file", "blob", indexOid], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    absolutePath,
    original,
  };
}

function prepareRepair(repoRoot, repair, preimageMode) {
  if (repair.confidence !== "exact" && repair.confidence !== "corroborated") {
    throw new Error(`repair remains unresolved: ${repair.path}`);
  }

  const { absolutePath, original } = readRepairPreimage(repoRoot, repair, preimageMode);
  const actualSha256 = hashBytes(original);
  const expectedPreimageSha256 = requireSha256(
    repair.preimageSha256,
    "preimage SHA-256",
    repair.path,
  );
  const expectedPostimageSha256 = requireSha256(
    repair.expectedPostimageSha256,
    "expected postimage SHA-256",
    repair.path,
  );
  if (actualSha256 !== expectedPreimageSha256) {
    throw new Error(
      `preimage SHA-256 mismatch for ${repair.path}: expected ${expectedPreimageSha256}, got ${actualSha256}`,
    );
  }

  if (!Array.isArray(repair.replacements) || repair.replacements.length === 0) {
    throw new Error(`repair has no source-aligned spans: ${repair.path}`);
  }
  const replacements = repair.replacements.map((replacement) => {
    if (!Array.isArray(replacement.evidenceIds) || replacement.evidenceIds.length === 0) {
      throw new Error(`replacement is missing evidence IDs: ${repair.path}`);
    }
    return {
      ...replacement,
      remove: decodeReplacementHex(replacement.removeHex, "removeHex"),
      insert: decodeReplacementHex(replacement.insertHex, "insertHex"),
      leftAnchor: decodeReplacementHex(replacement.leftAnchorHex, "leftAnchorHex"),
      rightAnchor: decodeReplacementHex(replacement.rightAnchorHex, "rightAnchorHex"),
    };
  });

  const ascending = replacements.toSorted(
    (left, right) => left.currentOffset - right.currentOffset,
  );
  for (let index = 0; index < ascending.length; index += 1) {
    const replacement = ascending[index];
    if (!Number.isInteger(replacement.currentOffset) || replacement.currentOffset < 0) {
      throw new Error(`replacement offset is invalid: ${repair.path}`);
    }
    if (replacement.remove.length === 0) {
      throw new Error(`removeHex must not be empty: ${repair.path}`);
    }
    if (replacement.currentOffset + replacement.remove.length > original.length) {
      throw new Error(`replacement exceeds preimage: ${repair.path}`);
    }
    if (
      index > 0 &&
      replacement.currentOffset <
        ascending[index - 1].currentOffset + ascending[index - 1].remove.length
    ) {
      throw new Error(`replacement ranges overlap: ${repair.path}`);
    }
    const actual = original.subarray(
      replacement.currentOffset,
      replacement.currentOffset + replacement.remove.length,
    );
    if (!actual.equals(replacement.remove)) {
      throw new Error(`remove bytes mismatch for ${repair.path}`);
    }
    const actualLeftAnchor = original.subarray(
      replacement.currentOffset - replacement.leftAnchor.length,
      replacement.currentOffset,
    );
    const actualRightAnchor = original.subarray(
      replacement.currentOffset + replacement.remove.length,
      replacement.currentOffset + replacement.remove.length + replacement.rightAnchor.length,
    );
    if (
      !actualLeftAnchor.equals(replacement.leftAnchor) ||
      !actualRightAnchor.equals(replacement.rightAnchor)
    ) {
      throw new Error(`source-span anchor mismatch for ${repair.path}`);
    }
  }

  let output = original;
  for (const replacement of ascending.toReversed()) {
    output = Buffer.concat([
      output.subarray(0, replacement.currentOffset),
      replacement.insert,
      output.subarray(replacement.currentOffset + replacement.remove.length),
    ]);
  }
  const postimageSha256 = hashBytes(output);
  if (postimageSha256 !== expectedPostimageSha256) {
    throw new Error(
      `postimage SHA-256 mismatch for ${repair.path}: expected ${expectedPostimageSha256}, got ${postimageSha256}`,
    );
  }

  return {
    path: repair.path,
    absolutePath,
    output,
    preimageSha256: actualSha256,
    postimageSha256,
  };
}

function materializeWorktreeOutput(repoRoot, repair, preimageMode) {
  if (preimageMode === "worktree") {
    return {
      ...repair,
      worktreeOutput: repair.output,
    };
  }
  const outputOid = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: repair.output,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  }).trim();
  const worktreeOutput = execFileSync(
    "git",
    ["cat-file", "--filters", `--path=${repair.path}`, outputOid],
    {
      cwd: repoRoot,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return {
    ...repair,
    worktreeOutput,
  };
}

export function applyRecoveryManifest({ repoRoot, manifest }) {
  if (
    manifest?.schemaVersion !== 2 ||
    manifest.spanModel !== "source-aligned-variable-length" ||
    !Array.isArray(manifest.repairs)
  ) {
    throw new Error("invalid recovery manifest");
  }

  const preimageMode = manifest.preimageMode ?? "worktree";
  if (preimageMode !== "worktree" && preimageMode !== "git-index") {
    throw new Error(`invalid recovery preimage mode: ${preimageMode}`);
  }
  const prepared = manifest.repairs.map((repair) =>
    prepareRepair(repoRoot, repair, preimageMode),
  );
  const materialized = prepared.map((repair) =>
    materializeWorktreeOutput(repoRoot, repair, preimageMode),
  );
  for (const repair of materialized) {
    fs.writeFileSync(repair.absolutePath, repair.worktreeOutput);
  }
  return materialized.map(({ path: repairPath, preimageSha256, postimageSha256 }) => ({
    path: repairPath,
    preimageSha256,
    postimageSha256,
  }));
}

function parseCliArgs(argv) {
  const options = {
    root: undefined,
    pathspec: "openclaw_runtime",
    output: undefined,
    replacementAllowlist: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      options.root = argv[++index];
    } else if (argument === "--all") {
      options.pathspec = undefined;
    } else if (argument === "--pathspec") {
      options.pathspec = argv[++index];
    } else if (argument === "--output") {
      options.output = argv[++index];
    } else if (argument === "--replacement-allowlist") {
      options.replacementAllowlist = argv[++index];
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.root || !options.output) {
    throw new Error("--root and --output are required");
  }
  return options;
}

function writeJsonAtomic(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, absolutePath);
}

function runCli() {
  const options = parseCliArgs(process.argv.slice(2));
  const replacementAllowlist = options.replacementAllowlist
    ? JSON.parse(fs.readFileSync(path.resolve(options.replacementAllowlist), "utf8"))
    : undefined;
  const manifest = scanTrackedFiles({
    repoRoot: path.resolve(options.root),
    pathspec: options.pathspec,
    replacementAllowlist,
  });
  writeJsonAtomic(options.output, manifest);
  const { summary } = manifest;
  const replacements = manifest.replacementCharacters.summary;
  process.stdout.write(
    [
      `trackedFiles=${summary.trackedFiles}`,
      `textFiles=${summary.textFiles}`,
      `binaryFiles=${summary.binaryFiles}`,
      `invalidFiles=${summary.invalidFiles}`,
      `invalidUnits=${summary.invalidUnits}`,
      `worktreeMismatches=${summary.worktreeMismatches}`,
      `replacementUnits=${replacements.units}`,
      `unallowedReplacementUnits=${replacements.unallowedUnits}`,
      `replacementAllowlistErrors=${replacements.allowlistErrors}`,
    ].join(" ") + "\n",
  );
  if (
    summary.invalidUnits > 0 ||
    summary.worktreeMismatches > 0 ||
    replacements.unallowedUnits > 0 ||
    replacements.allowlistErrors > 0
  ) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
