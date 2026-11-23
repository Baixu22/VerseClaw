import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditTool } from "./edit.js";
import { readEditNotApplied } from "../../file-mutation-outcome.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "edit-byte-outcome-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const encode = (text: string, utf16: boolean) =>
  utf16
    ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])
    : Buffer.from(text, "utf8");

describe("edit acknowledgement outcome from full byte readback", () => {
  it("does not replay an old rejection proof from a reused Error and call ID", async () => {
    const file = join(root, "result.txt");
    await writeFile(file, "before\nkeep\n");
    const sharedError = Object.assign(new Error("shared failure", { cause: "original cause" }), {
      code: "EIO",
      errno: 5,
    });
    let rejectRead = true;
    const tool = createEditTool(root, {
      operations: {
        access: async () => {},
        readFile: async (path) => {
          if (rejectRead) {
            rejectRead = false;
            throw sharedError;
          }
          return readFile(path);
        },
        writeFile: async (path) => {
          await writeFile(path, "after\n");
          throw sharedError;
        },
      },
    });
    const args = { path: "result.txt", edits: [{ oldText: "before", newText: "after" }] };
    const first = await tool.execute("same-call", args).then(
      () => undefined,
      (error) => error,
    );
    expect(readEditNotApplied(first, "same-call", "edit")?.owner).toBe("edit-file-operations");
    const second = await tool.execute("same-call", args).then(
      () => undefined,
      (error) => error,
    );
    expect(second).not.toBe(first);
    expect(second).toMatchObject({
      message: "shared failure",
      code: "EIO",
      errno: 5,
      cause: "original cause",
    });
    expect(second.stack).toBe(sharedError.stack);
    expect(readEditNotApplied(second, "same-call", "edit")).toBeUndefined();
    expect(await readFile(file, "utf8")).toBe("after\n");
  });
  it.each([false, true])(
    "recovers only a fully written file after acknowledgement loss (UTF16: %s)",
    async (utf16) => {
      const file = join(root, "result.txt");
      await writeFile(file, encode("before\nkeep\n", utf16));
      const tool = createEditTool(root, {
        operations: {
          access: async () => {},
          readFile,
          writeFile: async (path, content) => {
            await writeFile(path, content);
            throw new Error("acknowledgement lost");
          },
        },
      });
      const result = await tool.execute("full", {
        path: "result.txt",
        edits: [{ oldText: "before", newText: "after" }],
      });
      expect(result.content).toContainEqual({
        type: "text",
        text: "Successfully replaced 1 block(s) in result.txt.",
      });
      expect(await readFile(file)).toEqual(encode("after\nkeep\n", utf16));
    },
  );
  it.each([false, true])(
    "rejects loss of an untouched tail after write dispatch (UTF16: %s)",
    async (utf16) => {
      const file = join(root, "result.txt");
      await writeFile(file, encode("before\nkeep\n", utf16));
      const tool = createEditTool(root, {
        operations: {
          access: async () => {},
          readFile,
          writeFile: async (path) => {
            await writeFile(path, encode("after\n", utf16));
            throw new Error("acknowledgement lost");
          },
        },
      });
      const error = await tool
        .execute("partial", {
          path: "result.txt",
          edits: [{ oldText: "before", newText: "after" }],
        })
        .then(
          () => undefined,
          (error) => error,
        );
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("acknowledgement lost");
      expect(readEditNotApplied(error, "partial", "edit")).toBeUndefined();
      expect(await readFile(file)).toEqual(encode("after\n", utf16));
    },
  );
});
