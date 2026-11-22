import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestOwnerReadContent } from "openclaw/plugin-sdk/memory-host-core";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";

const REVISION = "2c4565515e0f265c6511776e7193b22c0968ddc7";
const FILES = [
  {
    name: "tokenizer.json",
    bytes: 11423705,
    hash: "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a",
  },
  {
    name: "tokenizer_config.json",
    bytes: 5404,
    hash: "355f2b4e5bad7b01f11ef6cb68ebc176f61b95c3276092ea225b1bea0e01e95c",
  },
] as const;

/** The client counts the complete VL text wrapper, including its generation prefix. */
export async function createQwenVlTextTokenizer(directory: string, signal: AbortSignal) {
  await mkdir(directory, { recursive: true });
  const objects: object[] = [];
  for (const artifact of FILES) {
    signal.throwIfAborted();
    const file = path.join(directory, `${artifact.hash}-${artifact.name}`);
    let bytes: Buffer | undefined;
    try {
      const metadata = await lstat(file);
      if (metadata.isFile() && metadata.size === artifact.bytes) bytes = await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const valid = (value: Buffer | undefined) =>
      value?.length === artifact.bytes &&
      createHash("sha256").update(value).digest("hex") === artifact.hash;
    if (!valid(bytes)) {
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < artifact.bytes * 2 + 16 * 1024 * 1024) {
        throw new Error("Insufficient disk budget for embedding tokenizer artifacts");
      }
      // The configure operation supplies one ten-minute total signal. It covers
      // connection, headers and this streamed body; explicit cancellation aborts it immediately.
      const { response, release } = await fetchWithSsrFGuard({
        url: `https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B/resolve/${REVISION}/${artifact.name}`,
        signal,
        auditContext: "project-rag:tokenizer-install",
      });
      try {
        if (!response.ok || !response.body)
          throw new Error(`Embedding tokenizer download failed: HTTP ${response.status}`);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          size += chunk.length;
          if (size > artifact.bytes)
            throw new Error("Embedding tokenizer download exceeds pinned size");
          chunks.push(Buffer.from(chunk));
        }
        bytes = Buffer.concat(chunks);
      } finally {
        await release();
      }
      if (!valid(bytes))
        throw new Error("Embedding tokenizer checksum differs from its pinned artifact");
      const staging = `${file}.${createHash("sha256")
        .update(String(process.pid) + String(Date.now()))
        .digest("hex")
        .slice(0, 12)}.part`;
      try {
        await writeFile(staging, bytes!, { flag: "wx" });
        signal.throwIfAborted();
        await rename(staging, file);
      } finally {
        await rm(staging, { force: true });
      }
    }
    signal.throwIfAborted();
    objects.push(JSON.parse(bytes!.toString("utf8")) as object);
  }
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizer = new Tokenizer(objects[0], objects[1]);
  const id = "Qwen3-VL-Embedding-8B/text-chat-wrapper-v1";
  return {
    id,
    digest: digestOwnerReadContent(
      JSON.stringify([REVISION, FILES, id, "@huggingface/tokenizers@0.2.0"]),
    ),
    count: (text: string) =>
      tokenizer.encode(
        `<|im_start|>system\nRepresent the user's input.<|im_end|>\n<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant\n`,
        { add_special_tokens: false },
      ).ids.length,
  };
}
