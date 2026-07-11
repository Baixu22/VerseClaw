function requireBuffer(value, label) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError(`${label} must be a Buffer`);
  }
}

function normalizeRanges(ranges, lineLength) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new Error("at least one malformed range is required");
  }
  const sorted = ranges
    .map((range) => ({
      currentOffset: range.currentOffset,
      length: range.length,
    }))
    .toSorted((left, right) => left.currentOffset - right.currentOffset);
  for (let index = 0; index < sorted.length; index += 1) {
    const range = sorted[index];
    if (
      !Number.isInteger(range.currentOffset) ||
      !Number.isInteger(range.length) ||
      range.currentOffset < 0 ||
      range.length <= 0 ||
      range.currentOffset + range.length > lineLength
    ) {
      throw new Error("malformed range is outside the current line");
    }
    if (
      index > 0 &&
      range.currentOffset < sorted[index - 1].currentOffset + sorted[index - 1].length
    ) {
      throw new Error("malformed ranges overlap");
    }
  }
  return sorted;
}

export function coalesceNearbyRanges(ranges, maximumGap = 8) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return [];
  }
  if (!Number.isInteger(maximumGap) || maximumGap < 0) {
    throw new Error("maximumGap must be a non-negative integer");
  }
  const sorted = ranges
    .map((range) => ({
      currentOffset: range.currentOffset,
      length: range.length,
      recordIds: [...range.recordIds],
    }))
    .toSorted((left, right) => left.currentOffset - right.currentOffset);
  const result = [sorted[0]];
  for (const range of sorted.slice(1)) {
    const previous = result.at(-1);
    const previousEnd = previous.currentOffset + previous.length;
    const gap = range.currentOffset - previousEnd;
    if (gap < 0) {
      throw new Error("malformed ranges overlap");
    }
    if (gap <= maximumGap) {
      previous.length = range.currentOffset + range.length - previous.currentOffset;
      previous.recordIds.push(...range.recordIds);
    } else {
      result.push(range);
    }
  }
  return result;
}

function findAll(buffer, part, start, end) {
  const offsets = [];
  if (part.length === 0) {
    return offsets;
  }
  for (let offset = buffer.indexOf(part, start); offset >= 0 && offset + part.length <= end; ) {
    offsets.push(offset);
    offset = buffer.indexOf(part, offset + 1);
  }
  return offsets;
}

export function deriveSourceSpans({
  currentLine,
  sourceLine,
  ranges,
  anchorBytes = 16,
}) {
  requireBuffer(currentLine, "currentLine");
  requireBuffer(sourceLine, "sourceLine");
  if (!Number.isInteger(anchorBytes) || anchorBytes < 0) {
    throw new Error("anchorBytes must be a non-negative integer");
  }
  const sortedRanges = normalizeRanges(ranges, currentLine.length);

  const segments = [];
  let currentCursor = 0;
  for (const range of sortedRanges) {
    segments.push(currentLine.subarray(currentCursor, range.currentOffset));
    currentCursor = range.currentOffset + range.length;
  }
  segments.push(currentLine.subarray(currentCursor));

  const sourceStarts = new Array(segments.length);
  const sourceEnds = new Array(segments.length);
  const first = segments[0];
  const last = segments.at(-1);
  const suffixStart = sourceLine.length - last.length;
  if (
    suffixStart < first.length ||
    !sourceLine.subarray(0, first.length).equals(first) ||
    !sourceLine.subarray(suffixStart).equals(last)
  ) {
    throw new Error("source line preserved prefix or suffix does not match");
  }
  sourceStarts[0] = 0;
  sourceEnds[0] = first.length;
  sourceStarts[segments.length - 1] = suffixStart;
  sourceEnds[segments.length - 1] = sourceLine.length;

  let sourceCursor = first.length;
  for (let index = 1; index < segments.length - 1; index += 1) {
    const part = segments[index];
    const matches = findAll(sourceLine, part, sourceCursor, suffixStart);
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? "preserved internal segment does not match"
          : "ambiguous preserved segment",
      );
    }
    sourceStarts[index] = matches[0];
    sourceEnds[index] = matches[0] + part.length;
    sourceCursor = sourceEnds[index];
  }

  return sortedRanges.map((range, index) => {
    const sourceOffset = sourceEnds[index];
    const sourceEnd = sourceStarts[index + 1];
    if (sourceEnd < sourceOffset) {
      throw new Error("source spans overlap after alignment");
    }
    const leftAnchorStart = Math.max(0, range.currentOffset - anchorBytes);
    const rightAnchorEnd = Math.min(
      currentLine.length,
      range.currentOffset + range.length + anchorBytes,
    );
    return {
      currentOffset: range.currentOffset,
      removeHex: currentLine
        .subarray(range.currentOffset, range.currentOffset + range.length)
        .toString("hex"),
      insertHex: sourceLine.subarray(sourceOffset, sourceEnd).toString("hex"),
      leftAnchorHex: currentLine.subarray(leftAnchorStart, range.currentOffset).toString("hex"),
      rightAnchorHex: currentLine
        .subarray(range.currentOffset + range.length, rightAnchorEnd)
        .toString("hex"),
      sourceOffset,
      sourceLength: sourceEnd - sourceOffset,
    };
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function splitLines(bytes) {
  const result = [];
  let start = 0;
  for (let offset = 0; offset <= bytes.length; offset += 1) {
    if (offset !== bytes.length && bytes[offset] !== 0x0a) {
      continue;
    }
    let end = offset;
    if (end > start && bytes[end - 1] === 0x0d) {
      end -= 1;
    }
    result.push({
      start,
      end,
      bytes: bytes.subarray(start, end),
    });
    start = offset + 1;
  }
  return result;
}

export function mapLinesByStableAnchors(currentLines, sourceLines) {
  const currentCount = currentLines.length;
  const sourceCount = sourceLines.length;
  const width = sourceCount + 1;
  const table = new Uint32Array((currentCount + 1) * width);
  for (let currentIndex = currentCount - 1; currentIndex >= 0; currentIndex -= 1) {
    for (let sourceIndex = sourceCount - 1; sourceIndex >= 0; sourceIndex -= 1) {
      const cell = currentIndex * width + sourceIndex;
      if (currentLines[currentIndex].equals(sourceLines[sourceIndex])) {
        table[cell] = 1 + table[(currentIndex + 1) * width + sourceIndex + 1];
      } else {
        table[cell] = Math.max(
          table[(currentIndex + 1) * width + sourceIndex],
          table[currentIndex * width + sourceIndex + 1],
        );
      }
    }
  }

  const anchors = [];
  let currentIndex = 0;
  let sourceIndex = 0;
  while (currentIndex < currentCount && sourceIndex < sourceCount) {
    if (currentLines[currentIndex].equals(sourceLines[sourceIndex])) {
      anchors.push([currentIndex, sourceIndex]);
      currentIndex += 1;
      sourceIndex += 1;
    } else if (
      table[(currentIndex + 1) * width + sourceIndex] >=
      table[currentIndex * width + sourceIndex + 1]
    ) {
      currentIndex += 1;
    } else {
      sourceIndex += 1;
    }
  }

  const mapping = new Array(currentCount);
  const boundedAnchors = [[-1, -1], ...anchors, [currentCount, sourceCount]];
  for (let index = 0; index < boundedAnchors.length - 1; index += 1) {
    const [currentBefore, sourceBefore] = boundedAnchors[index];
    const [currentAfter, sourceAfter] = boundedAnchors[index + 1];
    if (currentBefore >= 0) {
      mapping[currentBefore] = sourceBefore;
    }
    const currentGap = currentAfter - currentBefore - 1;
    const sourceGap = sourceAfter - sourceBefore - 1;
    if (currentGap === sourceGap) {
      for (let gapIndex = 1; gapIndex <= currentGap; gapIndex += 1) {
        mapping[currentBefore + gapIndex] = sourceBefore + gapIndex;
      }
    }
  }
  return mapping;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${name}`);
    }
    options[name.slice(2)] = argv[++index];
  }
  const required = [
    "repo",
    "report",
    "output",
    "summary",
    "historical-root",
    "current-root",
    "history-git-dir",
    "local-report",
  ];
  for (const name of required) {
    if (!options[name]) {
      throw new Error(`--${name} is required`);
    }
  }
  return options;
}

function readGitBlob(repoRoot, repositoryPath) {
  return execFileSync("git", ["-C", repoRoot, "show", `HEAD:${repositoryPath}`], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function readHistoryBlob(gitDir, oid) {
  return execFileSync("git", ["--git-dir", gitDir, "cat-file", "blob", oid], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function sourceFamily(sourceId) {
  if (sourceId.startsWith("upstream:")) {
    return "upstream";
  }
  if (sourceId.startsWith("local-history:")) {
    return "local-history";
  }
  return "unknown";
}

function sourceSpanKey(candidate) {
  return [
    candidate.removeHex,
    candidate.insertHex,
    candidate.leftAnchorHex,
    candidate.rightAnchorHex,
  ].join(":");
}

function classifyCandidates(candidates) {
  if (candidates.length === 0) {
    return { status: "unresolved", selectedSpan: null };
  }
  const bySpan = new Map();
  for (const candidate of candidates) {
    const key = sourceSpanKey(candidate);
    if (!bySpan.has(key)) {
      bySpan.set(key, []);
    }
    bySpan.get(key).push(candidate);
  }
  if (bySpan.size > 1) {
    return { status: "conflict", selectedSpan: null };
  }
  const [agreeing] = bySpan.values();
  const sourceIds = new Set(agreeing.map((candidate) => candidate.sourceId));
  return {
    status: sourceIds.size >= 2 ? "corroborated" : "candidate",
    selectedSpan: agreeing[0],
  };
}

export function corroborateCommentBySignature(record, signatureSupport, minimumSupport = 20) {
  if (
    record.status !== "candidate" ||
    record.risk !== "comment-line" ||
    !record.selectedSpan
  ) {
    return false;
  }
  const signature = `${record.selectedSpan.removeHex}:${record.selectedSpan.insertHex}`;
  const support = signatureSupport.get(signature);
  if (
    !support ||
    support.recordCount < minimumSupport ||
    new Set(support.sourceIds).size < 2
  ) {
    return false;
  }
  record.status = "corroborated";
  record.corroboratingEvidence = [
    {
      id: `cross-file-corruption-signature:${signature}`,
      method: "independently-corroborated-source-span-pattern",
      supportRecordCount: support.recordCount,
      supportSourceIds: [...new Set(support.sourceIds)].sort(),
      supportRecordIds: [...new Set(support.recordIds ?? [])].sort(),
    },
  ];
  return true;
}

function applySelectedSpans(original, records) {
  let output = original;
  const unique = new Map();
  for (const record of records) {
    const span = record.selectedSpan;
    unique.set(
      `${span.currentOffset}:${span.removeHex}:${span.insertHex}`,
      span,
    );
  }
  const descending = [...unique.values()]
    .toSorted((left, right) => right.currentOffset - left.currentOffset);
  for (const span of descending) {
    const remove = Buffer.from(span.removeHex, "hex");
    const insert = Buffer.from(span.insertHex, "hex");
    const actual = output.subarray(span.currentOffset, span.currentOffset + remove.length);
    if (!actual.equals(remove)) {
      throw new Error(`remove bytes changed during reconstruction at ${span.currentOffset}`);
    }
    output = Buffer.concat([
      output.subarray(0, span.currentOffset),
      insert,
      output.subarray(span.currentOffset + remove.length),
    ]);
  }
  new TextDecoder("utf-8", { fatal: true }).decode(output);
  return output;
}

function writeJson(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildSourceSpanReport({
  repoRoot,
  anchoredReportPath,
  historicalRoot,
  currentRoot,
  historyGitDir,
  localEvidenceReportPath,
}) {
  const anchoredBytes = fs.readFileSync(anchoredReportPath);
  const anchored = JSON.parse(anchoredBytes.toString("utf8"));
  const codepointReportPath = path.join(path.dirname(anchoredReportPath), "report.json");
  const codepointBytes = fs.readFileSync(codepointReportPath);
  const codepointReport = JSON.parse(codepointBytes.toString("utf8"));
  const riskByRecordId = new Map(
    codepointReport.records.map((record) => [record.id, record.risk]),
  );
  const localEvidence = JSON.parse(fs.readFileSync(localEvidenceReportPath, "utf8"));
  const localVersionsByPath = new Map(
    localEvidence.fileEvidence.map((file) => [file.path, file.versions]),
  );
  const sourceRoots = new Map([
    ["upstream:e993", historicalRoot],
    ["upstream:2026.6.11", currentRoot],
  ]);
  const currentFiles = new Map();
  const sourceFiles = new Map();
  const lineMappings = new Map();

  function currentFile(repositoryPath) {
    if (!currentFiles.has(repositoryPath)) {
      const bytes = readGitBlob(repoRoot, repositoryPath);
      currentFiles.set(repositoryPath, {
        bytes,
        lines: splitLines(bytes),
        sha256: sha256(bytes),
      });
    }
    return currentFiles.get(repositoryPath);
  }

  function sourceFile(sourceId, repositoryPath) {
    const key = `${sourceId}|${repositoryPath}`;
    if (!sourceFiles.has(key)) {
      let bytes;
      if (sourceRoots.has(sourceId)) {
        const relativePath = repositoryPath.replace(/^openclaw_runtime[\\/]/, "");
        bytes = fs.readFileSync(path.join(sourceRoots.get(sourceId), relativePath));
      } else if (sourceId.startsWith("local-history:")) {
        bytes = readHistoryBlob(historyGitDir, sourceId.slice("local-history:".length));
      } else {
        throw new Error(`unsupported source ID: ${sourceId}`);
      }
      sourceFiles.set(key, {
        bytes,
        lines: splitLines(bytes),
        sha256: sha256(bytes),
      });
    }
    return sourceFiles.get(key);
  }

  function mappedSourceLine(sourceId, repositoryPath, currentLineIndex) {
    const key = `${sourceId}|${repositoryPath}`;
    if (!lineMappings.has(key)) {
      const current = currentFile(repositoryPath);
      const source = sourceFile(sourceId, repositoryPath);
      lineMappings.set(
        key,
        mapLinesByStableAnchors(
          current.lines.map((line) => line.bytes),
          source.lines.map((line) => line.bytes),
        ),
      );
    }
    const sourceLineIndex = lineMappings.get(key)[currentLineIndex];
    return sourceLineIndex === undefined ? undefined : sourceLineIndex + 1;
  }

  const groups = new Map();
  for (const record of anchored.records) {
    const key = `${record.path}|${record.lineNumber}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }

  const outputRecords = new Map(
    anchored.records.map((record) => [
      record.id,
      {
        id: record.id,
        path: record.path,
        range: record.range,
        lineNumber: record.lineNumber,
        risk: riskByRecordId.get(record.id) ?? "unknown",
        previousStatus: record.status,
        status: "unresolved",
        selectedSpan: null,
        candidates: [],
        alignmentFailures: [],
      },
    ]),
  );

  for (const records of groups.values()) {
    records.sort((left, right) => left.range.offset - right.range.offset);
    const current = currentFile(records[0].path);
    const currentLine = current.lines[records[0].lineNumber - 1];
    if (!currentLine) {
      throw new Error(`current line is missing: ${records[0].id}`);
    }
    const choices = new Map();
    for (const candidate of records[0].candidates) {
      choices.set(`${candidate.sourceId}|${candidate.sourceLine}`, candidate);
    }
    for (const record of records.slice(1)) {
      const available = new Set(
        record.candidates.map((candidate) => `${candidate.sourceId}|${candidate.sourceLine}`),
      );
      for (const key of choices.keys()) {
        if (!available.has(key)) {
          choices.delete(key);
        }
      }
    }

    const attempted = new Set();
    function alignChoice(choice, alignmentMethod) {
      const choiceKey = `${choice.sourceId}|${choice.sourceLine}`;
      if (attempted.has(choiceKey)) {
        return;
      }
      attempted.add(choiceKey);
      let source;
      let sourceLine;
      try {
        source = sourceFile(choice.sourceId, records[0].path);
        sourceLine = source.lines[choice.sourceLine - 1];
        if (!sourceLine) {
          throw new Error("source line is missing");
        }
        const alignedRanges = coalesceNearbyRanges(
          records.map((record) => ({
            currentOffset: record.range.offset - currentLine.start,
            length: record.range.length,
            recordIds: [record.id],
          })),
        );
        const spans = deriveSourceSpans({
          currentLine: currentLine.bytes,
          sourceLine: sourceLine.bytes,
          ranges: alignedRanges,
        });
        for (let index = 0; index < alignedRanges.length; index += 1) {
          const alignedRange = alignedRanges[index];
          const span = spans[index];
          const globalCurrentOffset = currentLine.start + span.currentOffset;
          if (globalCurrentOffset !== currentLine.start + alignedRange.currentOffset) {
            throw new Error("aligned current offset differs from inventory");
          }
          const candidate = {
            spanId: `${records[0].path}@${globalCurrentOffset}-${
              globalCurrentOffset + alignedRange.length
            }`,
            inventoryRecordIds: alignedRange.recordIds,
            sourceId: choice.sourceId,
            sourceFamily: sourceFamily(choice.sourceId),
            alignmentMethod,
            sourceFileSha256: source.sha256,
            sourceLine: choice.sourceLine,
            sourceOffset: sourceLine.start + span.sourceOffset,
            sourceLength: span.sourceLength,
            currentOffset: globalCurrentOffset,
            removeHex: span.removeHex,
            insertHex: span.insertHex,
            leftAnchorHex: span.leftAnchorHex,
            rightAnchorHex: span.rightAnchorHex,
          };
          for (const recordId of alignedRange.recordIds) {
            outputRecords.get(recordId).candidates.push(candidate);
          }
        }
      } catch (error) {
        for (const record of records) {
          outputRecords.get(record.id).alignmentFailures.push({
            sourceId: choice.sourceId,
            sourceLine: choice.sourceLine,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    for (const choice of choices.values()) {
      alignChoice(choice, "anchored-codepoint-source-line");
    }

    const availableSourceIds = new Set(
      records.flatMap((record) =>
        outputRecords.get(record.id).candidates.map((candidate) => candidate.sourceId),
      ),
    );
    if (availableSourceIds.size < 2) {
      const fallbackSourceIds = [
        ...sourceRoots.keys(),
        ...(localVersionsByPath.get(records[0].path) ?? []).map(
          (version) => `local-history:${version.blobOid}`,
        ),
      ];
      for (const sourceId of fallbackSourceIds) {
        try {
          const sourceLine = mappedSourceLine(
            sourceId,
            records[0].path,
            records[0].lineNumber - 1,
          );
          if (sourceLine !== undefined) {
            alignChoice({ sourceId, sourceLine }, "stable-line-lcs");
          }
        } catch (error) {
          for (const record of records) {
            outputRecords.get(record.id).alignmentFailures.push({
              sourceId,
              sourceLine: null,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
  }

  const records = [...outputRecords.values()];
  for (const record of records) {
    const uniqueCandidates = new Map();
    for (const candidate of record.candidates) {
      uniqueCandidates.set(
        `${candidate.sourceId}|${candidate.sourceLine}|${sourceSpanKey(candidate)}`,
        candidate,
      );
    }
    record.candidates = [...uniqueCandidates.values()];
    const classification = classifyCandidates(record.candidates);
    record.status = classification.status;
    record.selectedSpan = classification.selectedSpan;
  }

  const signatureSupport = new Map();
  for (const record of records) {
    if (record.status !== "corroborated" || !record.selectedSpan) {
      continue;
    }
    const signature = `${record.selectedSpan.removeHex}:${record.selectedSpan.insertHex}`;
    if (!signatureSupport.has(signature)) {
      signatureSupport.set(signature, {
        recordCount: 0,
        sourceIds: [],
        recordIds: [],
      });
    }
    const support = signatureSupport.get(signature);
    support.recordCount += 1;
    support.recordIds.push(record.id);
    support.sourceIds.push(...record.candidates.map((candidate) => candidate.sourceId));
  }
  for (const record of records) {
    corroborateCommentBySignature(record, signatureSupport);
  }

  const fileResults = [];
  const recordsByFile = new Map();
  for (const record of records) {
    if (!recordsByFile.has(record.path)) {
      recordsByFile.set(record.path, []);
    }
    recordsByFile.get(record.path).push(record);
  }
  for (const [repositoryPath, fileRecords] of recordsByFile) {
    const current = currentFile(repositoryPath);
    const applicable = fileRecords.every(
      (record) => record.status === "corroborated" || record.status === "exact",
    );
    let expectedPostimageSha256 = null;
    let postimageStrictUtf8 = false;
    if (applicable) {
      const postimage = applySelectedSpans(current.bytes, fileRecords);
      expectedPostimageSha256 = sha256(postimage);
      postimageStrictUtf8 = true;
    }
    fileResults.push({
      path: repositoryPath,
      preimageSha256: current.sha256,
      recordCount: fileRecords.length,
      applicable,
      expectedPostimageSha256,
      postimageStrictUtf8,
    });
  }

  const counts = {
    exact: records.filter((record) => record.status === "exact").length,
    corroborated: records.filter((record) => record.status === "corroborated").length,
    candidate: records.filter((record) => record.status === "candidate").length,
    conflict: records.filter((record) => record.status === "conflict").length,
    unresolved: records.filter((record) => record.status === "unresolved").length,
  };
  return {
    schemaVersion: 2,
    spanModel: "source-aligned-variable-length",
    inventoryBaseCommit: anchored.inventoryBaseCommit,
    supersededEvidence: [
      {
        path: path.basename(codepointReportPath),
        sha256: sha256(codepointBytes),
        reason: "code-point-only evidence; not apply-ready",
      },
      {
        path: path.basename(anchoredReportPath),
        sha256: sha256(anchoredBytes),
        reason: "anchored code-point evidence; not apply-ready",
      },
    ],
    sources: [
      { id: "upstream:e993", root: historicalRoot },
      { id: "upstream:2026.6.11", root: currentRoot },
      { id: "local-history", gitDir: historyGitDir },
    ],
    counts,
    corruptionSignatures: [...signatureSupport.entries()]
      .map(([signature, support]) => ({
        signature,
        recordCount: support.recordCount,
        sourceIds: [...new Set(support.sourceIds)].sort(),
        recordIds: [...new Set(support.recordIds)].sort(),
      }))
      .toSorted((left, right) => right.recordCount - left.recordCount),
    files: fileResults.toSorted((left, right) => left.path.localeCompare(right.path)),
    records,
  };
}

function renderSummary(report) {
  const nonApplicableFiles = report.files.filter((file) => !file.applicable).length;
  return `# Variable-Length Source-Span Evidence

## Result

- Total records: ${report.records.length}
- Exact: ${report.counts.exact}
- Corroborated: ${report.counts.corroborated}
- Candidate: ${report.counts.candidate}
- Conflict: ${report.counts.conflict}
- Unresolved: ${report.counts.unresolved}
- Files with complete strict-UTF-8 in-memory reconstruction: ${
    report.files.length - nonApplicableFiles
  }
- Files still blocked: ${nonApplicableFiles}

The two prior semantic reports are retained as hashed evidence but are
superseded for repair application because they model code points rather than
complete source-aligned variable-length spans.
`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = buildSourceSpanReport({
    repoRoot: path.resolve(options.repo),
    anchoredReportPath: path.resolve(options.report),
    historicalRoot: path.resolve(options["historical-root"]),
    currentRoot: path.resolve(options["current-root"]),
    historyGitDir: path.resolve(options["history-git-dir"]),
    localEvidenceReportPath: path.resolve(options["local-report"]),
  });
  writeJson(path.resolve(options.output), report);
  fs.writeFileSync(path.resolve(options.summary), renderSummary(report), "utf8");
  const total = Object.values(report.counts).reduce((sum, count) => sum + count, 0);
  console.log(
    `records=${total} exact=${report.counts.exact} corroborated=${report.counts.corroborated} candidate=${report.counts.candidate} conflict=${report.counts.conflict} unresolved=${report.counts.unresolved}`,
  );
  process.exitCode =
    report.counts.candidate + report.counts.conflict + report.counts.unresolved > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
