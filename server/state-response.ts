import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
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
  // RFC 1952 permits concatenated gzip members. Keep the status envelope,
  // including its existing CSRF field, in a level-zero member. The messages
  // use a fresh compression dictionary with no status or authentication tokens.
  const status = await gzipAsync(prefix, { level: 0 });
  signal.throwIfAborted();
  res.set("Content-Encoding", "gzip");
  // One pipeline owns response backpressure, cancellation and error cleanup.
  async function* encoded() {
    yield status;
    const source = Readable.from(body());
    const zip = createGzip({ level: 1 });
    const pumping = pipeline(source, zip, { signal });
    void pumping.catch(() => {});
    try { yield* zip; await pumping; }
    finally { source.destroy(); zip.destroy(); await pumping.catch(() => {}); }
  }
  await pipeline(Readable.from(encoded()), res, { signal });
}
