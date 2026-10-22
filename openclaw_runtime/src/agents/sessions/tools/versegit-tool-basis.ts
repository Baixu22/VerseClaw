import { createHash } from "node:crypto";
import {
  VG_TOOL_BASIS_SCHEMA,
  type VerseGitToolBasis,
} from "../../../../../shared/versegit-runtime-contract.js";

export function verseGitSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verseGitLineCount(value: string): number {
  return value.length === 0 ? 1 : value.split("\n").length;
}

export function createVerseGitReadBasis(params: {
  path: string;
  lineStart: number;
  lineEnd: number;
  fileBuffer: Buffer;
  rangeContent: string;
  truncated: boolean;
}): VerseGitToolBasis {
  return {
    schema: VG_TOOL_BASIS_SCHEMA,
    kind: "read",
    path: params.path,
    lineStart: params.lineStart,
    lineEnd: params.lineEnd,
    fileSha256: verseGitSha256(params.fileBuffer),
    rangeSha256: verseGitSha256(params.rangeContent),
    truncated: params.truncated,
  };
}

export function createVerseGitWriteBasis(params: {
  path: string;
  content: string | Uint8Array;
  beforeSha256?: string | null;
}): VerseGitToolBasis {
  const content = typeof params.content === "string" ? Buffer.from(params.content, "utf8") : params.content;
  const text = typeof params.content === "string" ? params.content : Buffer.from(params.content).toString("utf8");
  return {
    schema: VG_TOOL_BASIS_SCHEMA,
    kind: "write",
    path: params.path,
    lineStart: 1,
    lineEnd: verseGitLineCount(text),
    beforeSha256: params.beforeSha256 ?? null,
    afterSha256: verseGitSha256(content),
  };
}

export function createVerseGitEditBasis(params: {
  path: string;
  beforeBuffer: Buffer;
  afterContent: string | Uint8Array;
  firstChangedLine?: number;
}): VerseGitToolBasis {
  const after = typeof params.afterContent === "string"
    ? Buffer.from(params.afterContent, "utf8")
    : params.afterContent;
  const afterText = typeof params.afterContent === "string"
    ? params.afterContent
    : Buffer.from(params.afterContent).toString("utf8");
  return {
    schema: VG_TOOL_BASIS_SCHEMA,
    kind: "edit",
    path: params.path,
    lineStart: Math.max(1, params.firstChangedLine ?? 1),
    lineEnd: verseGitLineCount(afterText),
    beforeSha256: verseGitSha256(params.beforeBuffer),
    afterSha256: verseGitSha256(after),
  };
}
