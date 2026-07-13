export type TextFileEncoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export type DecodedTextFile = {
  text: string;
  encoding: TextFileEncoding;
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

function decodeUtf16Be(buffer: Buffer): string {
  if (buffer.length % 2 !== 0) {
    throw new Error("UTF-16BE input has an odd byte count");
  }
  const swapped = Buffer.allocUnsafe(buffer.length);
  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString("utf16le");
}

function detectBomlessUtf16(buffer: Buffer): "utf16le" | "utf16be" | undefined {
  if (buffer.length < 4 || buffer.length % 2 !== 0) {
    return undefined;
  }
  let evenZeros = 0;
  let oddZeros = 0;
  const pairs = buffer.length / 2;
  for (let index = 0; index < buffer.length; index += 2) {
    if (buffer[index] === 0) {
      evenZeros += 1;
    }
    if (buffer[index + 1] === 0) {
      oddZeros += 1;
    }
  }
  if (oddZeros / pairs >= 0.3 && evenZeros / pairs <= 0.05) {
    return "utf16le";
  }
  if (evenZeros / pairs >= 0.3 && oddZeros / pairs <= 0.05) {
    return "utf16be";
  }
  return undefined;
}

function hasBinaryControls(text: string): boolean {
  let controls = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) {
      return true;
    }
    if ((code < 0x20 && char !== "\t" && char !== "\n" && char !== "\r" && char !== "\f") || code === 0x7f) {
      controls += 1;
    }
  }
  return controls > Math.max(1, Math.floor(text.length * 0.01));
}

function decodeUtf8Strict(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

export function decodeTextFile(buffer: Buffer, filePath: string): DecodedTextFile {
  try {
    if (startsWith(buffer, UTF8_BOM)) {
      return { text: decodeUtf8Strict(buffer.subarray(UTF8_BOM.length)), encoding: "utf8-bom" };
    }
    if (startsWith(buffer, UTF16LE_BOM)) {
      return {
        text: buffer.subarray(UTF16LE_BOM.length).toString("utf16le"),
        encoding: "utf16le",
      };
    }
    if (startsWith(buffer, UTF16BE_BOM)) {
      return {
        text: decodeUtf16Be(buffer.subarray(UTF16BE_BOM.length)),
        encoding: "utf16be",
      };
    }

    const utf16 = detectBomlessUtf16(buffer);
    const text =
      utf16 === "utf16le"
        ? buffer.toString("utf16le")
        : utf16 === "utf16be"
          ? decodeUtf16Be(buffer)
          : decodeUtf8Strict(buffer);
    if (hasBinaryControls(text)) {
      throw new Error("decoded text contains binary control bytes");
    }
    return { text, encoding: utf16 ?? "utf8" };
  } catch (error) {
    throw new Error(`Cannot read binary file as text: ${filePath}`, { cause: error });
  }
}

export function encodeTextFile(text: string, encoding: TextFileEncoding): Buffer {
  if (encoding === "utf8") {
    return Buffer.from(text, "utf8");
  }
  if (encoding === "utf8-bom") {
    return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
  }
  const littleEndian = Buffer.from(text, "utf16le");
  if (encoding === "utf16le") {
    return Buffer.concat([UTF16LE_BOM, littleEndian]);
  }
  const bigEndian = Buffer.allocUnsafe(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1];
    bigEndian[index + 1] = littleEndian[index];
  }
  return Buffer.concat([UTF16BE_BOM, bigEndian]);
}
