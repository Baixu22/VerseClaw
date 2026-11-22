import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { withRemoteHttpResponse } from "./remote-http.js";

export type LocalEmbeddingModelArtifact = {
  model: string;
  revision: string;
  filename: string;
  url: string;
  bytes: number;
  sha256: string;
};

export const DEFAULT_LOCAL_EMBEDDING_ARTIFACT: LocalEmbeddingModelArtifact = Object.freeze({
  model: "google/embeddinggemma-300m",
  revision: "66f974f8cd48cc3b9c41c516b95508e75b4bee64",
  filename: "embeddinggemma-300m-qat-Q8_0.gguf",
  url: "https://huggingface.co/ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/resolve/66f974f8cd48cc3b9c41c516b95508e75b4bee64/embeddinggemma-300m-qat-Q8_0.gguf",
  bytes: 328577056,
  sha256: "6fa0c02a9c302be6f977521d399b4de3a46310a4f2621ee0063747881b673f67",
});

export async function verifyLocalEmbeddingModel(
  file: string,
  artifact: LocalEmbeddingModelArtifact,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.size !== artifact.bytes) {
    throw new Error("Local embedding model size is invalid");
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file, { signal })) {
    hash.update(chunk);
    bytes += chunk.length;
    if (bytes > artifact.bytes)
      throw new Error("Local embedding model size changed during verification");
  }
  signal?.throwIfAborted();
  if (bytes !== artifact.bytes || hash.digest("hex") !== artifact.sha256) {
    throw new Error("Local embedding model checksum is invalid");
  }
}

/** Only a verified, complete artifact is moved into the model load path. */
export async function installLocalEmbeddingModel(options: {
  directory: string;
  artifact?: LocalEmbeddingModelArtifact;
  signal?: AbortSignal;
  onProgress?: (progress: {
    phase: "downloading" | "verifying";
    bytes: number;
    total: number;
  }) => void;
}): Promise<{ path: string; artifact: LocalEmbeddingModelArtifact; downloaded: boolean }> {
  const artifact = options.artifact ?? DEFAULT_LOCAL_EMBEDDING_ARTIFACT;
  if (
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes <= 0 ||
    path.basename(artifact.filename) !== artifact.filename ||
    /[\\/]/.test(artifact.filename) ||
    !artifact.url.startsWith("https://")
  ) {
    throw new Error("Invalid local embedding model artifact");
  }
  options.signal?.throwIfAborted();
  const directory = path.resolve(options.directory);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${artifact.sha256.slice(0, 16)}-${artifact.filename}`);
  try {
    await verifyLocalEmbeddingModel(target, artifact, options.signal);
    return { path: target, artifact, downloaded: false };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (
      error instanceof Error &&
      !error.message.startsWith("Local embedding model ") &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const disk = await statfs(directory);
  const requiredBytes = artifact.bytes * 2 + 128 * 1024 * 1024;
  if (disk.bavail * disk.bsize < requiredBytes) {
    throw new Error("Insufficient disk budget to install the local embedding model");
  }
  const staging = await mkdtemp(path.join(directory, ".install-"));
  if (path.dirname(staging) !== directory || !path.basename(staging).startsWith(".install-")) {
    throw new Error("Invalid embedding staging cleanup path");
  }
  try {
    const file = path.join(staging, artifact.filename);
    await withRemoteHttpResponse({
      url: artifact.url,
      signal: options.signal,
      auditContext: "project-rag:embedding-model-install",
      onResponse: async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(`Local embedding model download failed: HTTP ${response.status}`);
        }
        const declared = response.headers.get("content-length");
        if (declared !== null && Number(declared) !== artifact.bytes) {
          throw new Error("Local embedding download size differs from the pinned artifact");
        }
        const handle = await open(file, "wx");
        let bytes = 0;
        try {
          for await (const chunk of response.body) {
            options.signal?.throwIfAborted();
            bytes += chunk.length;
            if (bytes > artifact.bytes)
              throw new Error("Local embedding download exceeds pinned size");
            await handle.writeFile(chunk);
            options.onProgress?.({ phase: "downloading", bytes, total: artifact.bytes });
          }
        } finally {
          await handle.close();
        }
      },
    });
    options.signal?.throwIfAborted();
    options.onProgress?.({ phase: "verifying", bytes: artifact.bytes, total: artifact.bytes });
    await verifyLocalEmbeddingModel(file, artifact, options.signal);
    options.signal?.throwIfAborted();
    await rename(file, target);
    options.signal?.throwIfAborted();
    return { path: target, artifact, downloaded: true };
  } finally {
    // mkdtemp created this private staging directory; cleanup cannot traverse the cache root.
    await rm(staging, { recursive: true, force: true });
  }
}
