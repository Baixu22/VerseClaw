/** Bounded UTF-8 tail shared across output streams. Artifact owners retain cold content. */
export class ByteTail {
  private readonly chunks: Array<{ stream: string; bytes: Buffer }> = [];
  private retained = 0;
  rawBytes = 0;
  constructor(readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be positive");
  }
  append(stream: string, text: string): void {
    let bytes = Buffer.from(text, "utf8"); this.rawBytes += bytes.length;
    if (!bytes.length) return;
    if (bytes.length > this.maxBytes) bytes = Buffer.from(bytes.subarray(bytes.length - this.maxBytes));
    this.chunks.push({ stream, bytes }); this.retained += bytes.length;
    while (this.retained > this.maxBytes) {
      const first = this.chunks[0]; const excess = this.retained - this.maxBytes;
      if (first.bytes.length <= excess) { this.retained -= first.bytes.length; this.chunks.shift(); }
      else { first.bytes = Buffer.from(first.bytes.subarray(excess)); this.retained -= excess; }
    }
    const first = this.chunks[0]; let start = 0;
    while (start < first.bytes.length && (first.bytes[start] & 0xc0) === 0x80) start++;
    if (start) { first.bytes = Buffer.from(first.bytes.subarray(start)); this.retained -= start; }
    if (first.bytes.length === 0) this.chunks.shift();
  }
  text(stream?: string): string { return Buffer.concat(this.chunks.filter(chunk => !stream || chunk.stream === stream).map(chunk => chunk.bytes)).toString("utf8"); }
  get bytes(): number { return this.retained; }
  get omittedBytes(): number { return this.rawBytes - this.retained; }
}
