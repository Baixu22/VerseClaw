import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cameraTempPath,
  parseCameraClipPayload,
  parseCameraSnapPayload,
  writeCameraClipPayloadToFile,
  writeCameraPayloadToFile,
} from "./nodes-camera.js";
import {
  parseScreenRecordPayload,
  screenRecordTempPath,
  writeScreenRecordToFile,
} from "./nodes-screen.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "openclaw-nodes-media-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("node camera media payloads", () => {
  it("parses camera snap payloads with base64 or URL data", () => {
    expect(
      parseCameraSnapPayload({
        format: "jpg",
        base64: "aGVsbG8=",
        width: 640,
        height: 480,
      }),
    ).toEqual({
      format: "jpg",
      base64: "aGVsbG8=",
      width: 640,
      height: 480,
    });
    expect(
      parseCameraSnapPayload({
        format: "png",
        url: "https://node.example/camera.png",
        width: 800,
        height: 600,
      }),
    ).toEqual({
      format: "png",
      url: "https://node.example/camera.png",
      width: 800,
      height: 600,
    });
  });

  it.each([
    {},
    { format: "jpg", base64: "aGVsbG8=", height: 480 },
    { format: "jpg", width: 640, height: 480 },
  ])("rejects invalid camera snap payload %#", (payload) => {
    expect(() => parseCameraSnapPayload(payload)).toThrow("invalid camera.snap payload");
  });

  it("parses camera clip payloads", () => {
    expect(
      parseCameraClipPayload({
        format: "mp4",
        base64: "Y2xpcA==",
        durationMs: 3000,
        hasAudio: true,
      }),
    ).toEqual({
      format: "mp4",
      base64: "Y2xpcA==",
      durationMs: 3000,
      hasAudio: true,
    });
  });

  it.each([
    {},
    { format: "mp4", base64: "Y2xpcA==", hasAudio: true },
    { format: "mp4", base64: "Y2xpcA==", durationMs: 3000 },
  ])("rejects invalid camera clip payload %#", (payload) => {
    expect(() => parseCameraClipPayload(payload)).toThrow("invalid camera.clip payload");
  });

  it("builds controlled camera temp paths and rejects invalid extensions", async () => {
    const dir = await createTempDir();
    expect(
      cameraTempPath({
        kind: "snap",
        facing: "front",
        ext: "jpg",
        tmpDir: dir,
        id: "fixed",
      }),
    ).toBe(path.join(dir, "openclaw-camera-snap-front-fixed.jpg"));
    expect(() =>
      cameraTempPath({
        kind: "snap",
        ext: "../jpg",
        tmpDir: dir,
        id: "fixed",
      }),
    ).toThrow("invalid media format");
  });

  it("writes camera base64 payloads", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "snap.jpg");

    await writeCameraPayloadToFile({
      filePath,
      payload: {
        base64: Buffer.from("camera-bytes").toString("base64"),
      },
    });

    expect(await readFile(filePath, "utf8")).toBe("camera-bytes");
  });

  it("writes camera clips to a controlled temp path", async () => {
    const dir = await createTempDir();
    const filePath = await writeCameraClipPayloadToFile({
      payload: {
        format: "mp4",
        base64: Buffer.from("clip-bytes").toString("base64"),
        durationMs: 1000,
        hasAudio: false,
      },
      facing: "back",
      tmpDir: dir,
      id: "fixed",
    });

    expect(filePath).toBe(path.join(dir, "openclaw-camera-clip-back-fixed.mp4"));
    expect(await readFile(filePath, "utf8")).toBe("clip-bytes");
  });

  it("rejects non-HTTPS and mismatched-host camera URLs before fetching", async () => {
    const dir = await createTempDir();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      writeCameraPayloadToFile({
        filePath: path.join(dir, "http.jpg"),
        payload: {
          url: "http://node.example/camera.jpg",
        },
        expectedHost: "node.example",
      }),
    ).rejects.toThrow("only https URLs are allowed");

    await expect(
      writeCameraPayloadToFile({
        filePath: path.join(dir, "mismatch.jpg"),
        payload: {
          url: "https://other.example/camera.jpg",
        },
        expectedHost: "node.example",
      }),
    ).rejects.toThrow("must match node host");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("node screen media payloads", () => {
  it("parses valid screen record payloads and preserves optional metadata", () => {
    expect(
      parseScreenRecordPayload({
        format: "mp4",
        base64: "c2NyZWVu",
        durationMs: 1000,
        fps: 30,
        screenIndex: 1,
        hasAudio: false,
      }),
    ).toEqual({
      format: "mp4",
      base64: "c2NyZWVu",
      durationMs: 1000,
      fps: 30,
      screenIndex: 1,
      hasAudio: false,
    });
  });

  it.each([{}, { format: "mp4" }, { base64: "c2NyZWVu" }])(
    "rejects invalid screen record payload %#",
    (payload) => {
      expect(() => parseScreenRecordPayload(payload)).toThrow("invalid screen.record payload");
    },
  );

  it("builds controlled screen temp paths and rejects invalid extensions", async () => {
    const dir = await createTempDir();
    expect(screenRecordTempPath({ ext: ".webm", tmpDir: dir, id: "fixed" })).toBe(
      path.join(dir, "openclaw-screen-record-fixed.webm"),
    );
    expect(() => screenRecordTempPath({ ext: "..\\mp4", tmpDir: dir, id: "fixed" })).toThrow(
      "invalid media format",
    );
  });

  it("writes screen base64 and enforces decoded byte limits", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "screen.mp4");

    const written = await writeScreenRecordToFile(
      filePath,
      Buffer.from("screen-bytes").toString("base64"),
    );
    expect(written).toEqual({ path: filePath, bytes: 12 });
    expect(await readFile(filePath, "utf8")).toBe("screen-bytes");

    await expect(
      writeScreenRecordToFile(
        path.join(dir, "oversized.mp4"),
        Buffer.from("too-large").toString("base64"),
        { maxBytes: 2 },
      ),
    ).rejects.toThrow("decoded payload exceeds max 2");
  });
});
