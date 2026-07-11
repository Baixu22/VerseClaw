import { randomUUID } from "node:crypto";
import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { parseStrictNonNegativeInteger } from "@openclaw/normalization-core/number-coercion";
import { resolvePreferredOpenClawTmpDir } from "../../infra/tmp-openclaw-dir.js";
import { fetchWithSsrFGuard } from "../../infra/net/fetch-guard.js";
import { normalizeHostname } from "../../infra/net/hostname.js";

export const MAX_NODE_MEDIA_BYTES = 250 * 1024 * 1024;

export type ResolveTempPathPartsOptions = {
  ext: string;
  id?: string;
  tmpDir?: string;
};

export type MediaWriteResult = {
  path: string;
  bytes: number;
};

export function resolveTempPathParts(opts: ResolveTempPathPartsOptions): {
  tmpDir: string;
  id: string;
  ext: string;
} {
  const tmpDir = opts.tmpDir ?? resolvePreferredOpenClawTmpDir();
  const rawExt = opts.ext.startsWith(".") ? opts.ext : `.${opts.ext}`;
  if (!/^\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/u.test(rawExt)) {
    throw new Error("invalid media format");
  }
  if (!opts.tmpDir) {
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  }
  return {
    tmpDir,
    id: opts.id ?? randomUUID(),
    ext: rawExt,
  };
}

export function estimateDecodedBase64Bytes(base64: string): number {
  const normalized = base64.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

export async function writeBase64ToFile(
  filePath: string,
  base64: string,
  opts: { maxBytes?: number } = {},
): Promise<MediaWriteResult> {
  const maxBytes = opts.maxBytes ?? MAX_NODE_MEDIA_BYTES;
  if (estimateDecodedBase64Bytes(base64) > maxBytes) {
    throw new Error(`writeBase64ToFile: decoded payload exceeds max ${maxBytes}`);
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > maxBytes) {
    throw new Error(
      `writeBase64ToFile: decoded ${buffer.length} bytes, exceeds max ${maxBytes}`,
    );
  }
  await fsPromises.writeFile(filePath, buffer);
  return { path: filePath, bytes: buffer.length };
}

export async function writeUrlToFile(
  filePath: string,
  url: string,
  opts: { expectedHost: string; maxBytes?: number },
): Promise<MediaWriteResult> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`writeUrlToFile: only https URLs are allowed, got ${parsed.protocol}`);
  }

  const expectedHost = normalizeHostname(opts.expectedHost);
  if (!expectedHost) {
    throw new Error("writeUrlToFile: expectedHost is required");
  }
  if (normalizeHostname(parsed.hostname) !== expectedHost) {
    throw new Error(
      `writeUrlToFile: url host ${parsed.hostname} must match node host ${opts.expectedHost}`,
    );
  }

  const maxBytes = opts.maxBytes ?? MAX_NODE_MEDIA_BYTES;
  const policy = {
    allowPrivateNetwork: true,
    allowedHostnames: [expectedHost],
    hostnameAllowlist: [expectedHost],
  };
  let release = async (): Promise<void> => {};
  let bytes = 0;

  try {
    const guarded = await fetchWithSsrFGuard({
      url,
      auditContext: "writeUrlToFile",
      policy,
    });
    release = guarded.release;

    const finalUrl = new URL(guarded.finalUrl);
    if (finalUrl.protocol !== "https:") {
      throw new Error(
        `writeUrlToFile: redirect resolved to non-https URL ${guarded.finalUrl}`,
      );
    }
    if (normalizeHostname(finalUrl.hostname) !== expectedHost) {
      throw new Error(
        `writeUrlToFile: redirect host ${finalUrl.hostname} must match node host ${opts.expectedHost}`,
      );
    }

    const response = guarded.response;
    if (!response.ok) {
      throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const contentLength = parseStrictNonNegativeInteger(
      response.headers.get("content-length"),
    );
    if (
      typeof contentLength === "number" &&
      Number.isFinite(contentLength) &&
      contentLength > maxBytes
    ) {
      throw new Error(
        `writeUrlToFile: content-length ${contentLength} exceeds max ${maxBytes}`,
      );
    }

    const body = response.body;
    if (!body) {
      throw new Error(`failed to download ${url}: empty response body`);
    }

    const fileHandle = await fsPromises.open(filePath, "w");
    let thrown: unknown;
    try {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          throw new Error(
            `writeUrlToFile: downloaded ${bytes} bytes, exceeds max ${maxBytes}`,
          );
        }
        await fileHandle.write(value);
      }
    } catch (error) {
      thrown = error;
    } finally {
      await fileHandle.close();
    }
    if (thrown) {
      await fsPromises.unlink(filePath).catch(() => {});
      throw thrown;
    }
  } finally {
    await release();
  }

  return { path: filePath, bytes };
}
