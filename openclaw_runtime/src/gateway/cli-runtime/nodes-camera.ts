import path from "node:path";
import { asFiniteNumber } from "@openclaw/normalization-core/number-coercion";
import { asRecord } from "@openclaw/normalization-core/record-coerce";
import { readStringValue } from "@openclaw/normalization-core/string-coerce";
import { asBoolean } from "../../utils/boolean.js";
import { resolveCliName } from "./cli-name.js";
import {
  resolveTempPathParts,
  writeBase64ToFile,
  writeUrlToFile,
} from "./nodes-media-utils.js";

export type CameraFacing = "front" | "back" | "environment" | "user";

export type CameraTempPathOptions = {
  kind: "snap" | "clip";
  ext: string;
  facing?: CameraFacing;
  id?: string;
  tmpDir?: string;
};

export function cameraTempPath(opts: CameraTempPathOptions): string {
  const { tmpDir, id, ext } = resolveTempPathParts(opts);
  const facingPart = opts.facing ? `-${opts.facing}` : "";
  return path.join(
    tmpDir,
    `${resolveCliName()}-camera-${opts.kind}${facingPart}-${id}${ext}`,
  );
}

export type ParsedCameraSnapPayload = {
  format: string;
  base64?: string;
  url?: string;
  width: number;
  height: number;
};

export function parseCameraSnapPayload(value: unknown): ParsedCameraSnapPayload {
  const object = asRecord(value);
  const format = readStringValue(object.format);
  const base64 = readStringValue(object.base64);
  const url = readStringValue(object.url);
  const width = asFiniteNumber(object.width);
  const height = asFiniteNumber(object.height);
  if (!format || (!base64 && !url) || width === undefined || height === undefined) {
    throw new Error("invalid camera.snap payload");
  }
  return {
    format,
    ...(base64 ? { base64 } : {}),
    ...(url ? { url } : {}),
    width,
    height,
  };
}

export type ParsedCameraClipPayload = {
  format: string;
  base64?: string;
  url?: string;
  durationMs: number;
  hasAudio: boolean;
};

export function parseCameraClipPayload(value: unknown): ParsedCameraClipPayload {
  const object = asRecord(value);
  const format = readStringValue(object.format);
  const base64 = readStringValue(object.base64);
  const url = readStringValue(object.url);
  const durationMs = asFiniteNumber(object.durationMs);
  const hasAudio = asBoolean(object.hasAudio);
  if (!format || (!base64 && !url) || durationMs === undefined || hasAudio === undefined) {
    throw new Error("invalid camera.clip payload");
  }
  return {
    format,
    ...(base64 ? { base64 } : {}),
    ...(url ? { url } : {}),
    durationMs,
    hasAudio,
  };
}

export async function writeCameraPayloadToFile(params: {
  filePath: string;
  payload: Pick<ParsedCameraSnapPayload, "base64" | "url">;
  expectedHost?: string;
  invalidPayloadMessage?: string;
}): Promise<void> {
  if (params.payload.url) {
    const expectedHost = params.expectedHost?.trim();
    if (!expectedHost) {
      throw new Error("camera URL payload requires node remoteIp");
    }
    await writeUrlToFile(params.filePath, params.payload.url, { expectedHost });
    return;
  }
  if (params.payload.base64) {
    await writeBase64ToFile(params.filePath, params.payload.base64);
    return;
  }
  throw new Error(params.invalidPayloadMessage ?? "invalid camera payload");
}

export async function writeCameraClipPayloadToFile(params: {
  payload: ParsedCameraClipPayload;
  facing: CameraFacing;
  expectedHost?: string;
  id?: string;
  tmpDir?: string;
}): Promise<string> {
  const filePath = cameraTempPath({
    kind: "clip",
    facing: params.facing,
    ext: params.payload.format,
    tmpDir: params.tmpDir,
    id: params.id,
  });
  await writeCameraPayloadToFile({
    filePath,
    payload: params.payload,
    expectedHost: params.expectedHost,
    invalidPayloadMessage: "invalid camera.clip payload",
  });
  return filePath;
}
