import path from "node:path";
import { asRecord } from "@openclaw/normalization-core/record-coerce";
import { readStringValue } from "@openclaw/normalization-core/string-coerce";
import {
  resolveTempPathParts,
  writeBase64ToFile,
  type MediaWriteResult,
} from "./nodes-media-utils.js";

export type ParsedScreenRecordPayload = {
  format: string;
  base64: string;
  durationMs?: number;
  fps?: number;
  screenIndex?: number;
  hasAudio?: boolean;
};

export function parseScreenRecordPayload(value: unknown): ParsedScreenRecordPayload {
  const object = asRecord(value);
  const format = readStringValue(object.format);
  const base64 = readStringValue(object.base64);
  if (!format || !base64) {
    throw new Error("invalid screen.record payload");
  }
  return {
    format,
    base64,
    durationMs: typeof object.durationMs === "number" ? object.durationMs : undefined,
    fps: typeof object.fps === "number" ? object.fps : undefined,
    screenIndex: typeof object.screenIndex === "number" ? object.screenIndex : undefined,
    hasAudio: typeof object.hasAudio === "boolean" ? object.hasAudio : undefined,
  };
}

export function screenRecordTempPath(opts: {
  ext: string;
  id?: string;
  tmpDir?: string;
}): string {
  const { tmpDir, id, ext } = resolveTempPathParts(opts);
  return path.join(tmpDir, `openclaw-screen-record-${id}${ext}`);
}

export async function writeScreenRecordToFile(
  filePath: string,
  base64: string,
  opts?: { maxBytes?: number },
): Promise<MediaWriteResult> {
  return await writeBase64ToFile(filePath, base64, opts);
}
