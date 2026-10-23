import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, unlinkSync } from "node:fs";
import path from "node:path";

export async function readResponseBytes(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit) {
    await response.body?.cancel();
    throw new Error("Response byte limit exceeded.");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Response byte limit exceeded.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export class ByteCache<T> {
  private entries = new Map<string, { value: T; bytes: number; expires: number }>();
  private bytes = 0;
  constructor(private maxEntries: number, private maxBytes: number, private ttl: number, private size: (value: T) => number, private now = Date.now) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry); this.bytes += entry.bytes;
    return entry.value;
  }
  set(key: string, value: T) {
    const old = this.entries.get(key);
    if (old) { this.entries.delete(key); this.bytes -= old.bytes; }
    const bytes = this.size(value);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes, expires: this.now() + this.ttl });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const key = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(key)!.bytes;
      this.entries.delete(key);
    }
  }
}

// Bound active work and admission as well as retained cache entries.
export function workLimit(activeLimit: number, waitingLimit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= activeLimit) {
      if (waiting.length >= waitingLimit) throw new Error("Resource queue limit exceeded.");
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else active++;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  };
}

export function readCacheFile(file: string, limit: number): { body: Buffer; fresh: boolean } | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) return null;
    // One extra byte detects growth after stat without an unbounded file read.
    const body = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < body.length) {
      const count = readSync(fd, body, size, body.length - size, null);
      if (!count) break;
      size += count;
    }
    return size <= stat.size ? { body: body.subarray(0, size), fresh: Date.now() - stat.mtimeMs < 3 * 86400000 } : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

// This directory contains only disposable logo images. Never touch mail storage.
export function trimImageCache(dir: string) {
  try {
    const directory = opendirSync(dir);
    const kept: { file: string; size: number; time: number }[] = [];
    let bytes = 0;
    try {
      let entry;
      while ((entry = directory.readSync())) {
        if (!entry.isFile() || !/\.(json|svg)$/.test(entry.name)) continue;
        const file = path.join(dir, entry.name);
        try {
          const stat = lstatSync(file);
          if (!stat.isFile()) continue;
          kept.push({ file, size: stat.size, time: stat.mtimeMs });
          kept.sort((a, b) => b.time - a.time);
          bytes += stat.size;
          while (kept.length > 256 || bytes > 16 * 1024 * 1024) {
            const oldest = kept.pop()!;
            bytes -= oldest.size;
            unlinkSync(oldest.file);
          }
        } catch { /* A concurrent cache write can replace an entry. */ }
      }
    } finally { directory.closeSync(); }
  } catch { /* Cache housekeeping is best effort. */ }
}

const preparedDirs = new ByteCache<boolean>(8, 8, 5 * 60000, () => 1);
export function prepareImageCache(dir: string) {
  if (preparedDirs.get(dir)) return;
  trimImageCache(dir);
  preparedDirs.set(dir, true);
}
