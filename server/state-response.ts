import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createDeflateRaw, crc32 } from "node:zlib";

const threshold = 16 * 1024;
const yieldLoop = () => new Promise<void>(resolve => setImmediate(resolve));

// Called only after the route's existing authentication, origin and snapshot
// checks. Never put request headers, cookies or session credentials in envelope.
export async function writeStateResponse(req: Request, res: Response, envelope: object, messages: readonly unknown[], signal: AbortSignal) {
  signal.throwIfAborted();
  res.type("json");
  res.set("Cache-Control", "no-store");
  res.vary("Accept-Encoding");
  const prefix = JSON.stringify(envelope).slice(0, -1) + ',"messages":[';
  async function* messageChunks() {
    for (let i = 0; i < messages.length; i += 32) {
      signal.throwIfAborted();
      const batch = messages.slice(i, i + 32).map(value => JSON.stringify(value));
      yield (i ? "," : "") + batch.join(",");
      await yieldLoop();
    }
    signal.throwIfAborted();
    yield "]}";
  }
  const chunks = messageChunks();
  const head: string[] = [];
  let bytes = 0;
  // Buffer only the threshold-sized lead, not the full snapshot. Express uses
  // the standard negotiator, including explicit zero quality and wildcards.
  const acceptsGzip = req.acceptsEncodings("gzip") === "gzip";
  if (acceptsGzip) {
    while (bytes < threshold) {
      const next = await chunks.next();
      if (next.done) break;
      head.push(next.value); bytes += Buffer.byteLength(next.value);
    }
  }
  const compressed = acceptsGzip && bytes >= threshold;
  async function* body() {
    if (!compressed) yield prefix;
    yield* head;
    yield* chunks;
  }
  if (!compressed) {
    await pipeline(Readable.from(body()), res, { signal });
    return;
  }
  // Some HTTP decoders stop after the first gzip member, so send exactly one.
  // Keep the status envelope, including its existing CSRF field, in stored
  // DEFLATE blocks. The messages follow as a raw DEFLATE stream with a fresh
  // dictionary that holds no status or authentication tokens.
  const status = Buffer.from(prefix);
  let crc = crc32(status), size = status.length;
  const stored: Buffer[] = [Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])];
  for (let i = 0; i < status.length; i += 0xffff) {
    const block = status.subarray(i, i + 0xffff), header = Buffer.alloc(5);
    header.writeUInt16LE(block.length, 1); header.writeUInt16LE(~block.length & 0xffff, 3);
    stored.push(header, block);
  }
  signal.throwIfAborted();
  res.set("Content-Encoding", "gzip");
  // One pipeline owns response backpressure, cancellation and error cleanup.
  async function* encoded() {
    yield Buffer.concat(stored);
    async function* counted() {
      for await (const chunk of body()) {
        const bytes = Buffer.from(chunk);
        crc = crc32(bytes, crc); size += bytes.length;
        yield bytes;
      }
    }
    const source = Readable.from(counted());
    const zip = createDeflateRaw({ level: 1 });
    const pumping = pipeline(source, zip, { signal });
    void pumping.catch(() => {});
    try { yield* zip; await pumping; }
    finally { source.destroy(); zip.destroy(); await pumping.catch(() => {}); }
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(crc >>> 0, 0); trailer.writeUInt32LE(size >>> 0, 4);
    yield trailer;
  }
  await pipeline(Readable.from(encoded()), res, { signal });
}
