// P5-2 CLI/TUI Deletion: nodes camera action stub.
//
// The original `cli/nodes-camera.ts` was retired along with the `cli/`
// directory. This stub preserves the public surface used by the
// `agents/tools/nodes-tool-media.ts` tool. At runtime, node camera
// media capture is not part of the headless gateway path, so the
// helpers all throw a "not implemented" error, but the symbols are
// importable so the module graph resolves cleanly.

import crypto from "node:crypto";

export type CameraFacing = "front" | "back" | "environment" | "user";

export function cameraTempPath(prefix: string, facing: CameraFacing): string {
  const safePrefix = String(prefix ?? "camera").replace(/[^a-z0-9_-]/gi, "_");
  return `nodes-camera-${safePrefix}-${facing}-${crypto.randomUUID()}.bin`;
}

export type ParsedCameraSnapPayload = {
  format: "jpeg" | "png";
  bytes: Uint8Array;
  width?: number;
  height?: number;
};

export function parseCameraSnapPayload(input: unknown): ParsedCameraSnapPayload | null {
  return null;
}

export type ParsedCameraClipPayload = {
  format: "mp4" | "mov";
  bytes: Uint8Array;
  durationMs?: number;
};

export function parseCameraClipPayload(input: unknown): ParsedCameraClipPayload | null {
  return null;
}

export async function writeCameraPayloadToFile(
  _payload: ParsedCameraSnapPayload,
  _filePath: string,
): Promise<void> {
  throw new Error("nodes-camera: writeCameraPayloadToFile is not implemented in the P5-2 headless runtime");
}

export async function writeCameraClipPayloadToFile(
  _payload: ParsedCameraClipPayload,
  _filePath: string,
): Promise<void> {
  throw new Error("nodes-camera: writeCameraClipPayloadToFile is not implemented in the P5-2 headless runtime");
}
