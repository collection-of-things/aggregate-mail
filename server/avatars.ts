import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logoDomain } from "../shared/types.js";
import { canonicalBase64Size } from "./mime-limits.js";
import { ByteCache, readCacheFile, readResponseBytes, trimImageCache, prepareImageCache, workLimit } from "./resource-limits.js";

// Company logos are fetched on the server and served from localhost, so the
// renderer never loads a remote image and no mailbox host is contacted for one.
const service = "https://icons.duckduckgo.com/ip3";
type Image = { body: Buffer; type: string };
const maxBytes = 512 * 1024;
const memory = new ByteCache<Image>(128, 8 * 1024 * 1024, 5 * 60000, (image) => image.body.length);
const misses = new ByteCache<boolean>(256, 256, 5 * 60000, () => 1);
const pending = new Map<string, Promise<Image | null>>();
const limited = workLimit(4, 32);
const cacheDir = () => path.resolve(process.env.MAIL_DATA_DIR || ".data", "logos");

const readCached = (file: string) => {
  const cached = readCacheFile(file, 700000);
  if (!cached) return null;
  try {
    const { body, type } = JSON.parse(cached.body.toString("utf8")) as { body: unknown; type: unknown };
    if (typeof body !== "string" || typeof type !== "string" || !/^image\/[\w.+-]+$/.test(type)) return null;
    const size = canonicalBase64Size(body);
    if (!size || size > maxBytes) return null;
    return { image: { body: Buffer.from(body, "base64"), type }, fresh: cached.fresh };
  } catch { return null; }
};
const writeCached = (file: string, image: Image) => {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify({ type: image.type, body: image.body.toString("base64") }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    trimImageCache(path.dirname(file));
  } catch {
    // A logo is decorative: a cache that cannot be written is not an error.
  }
};
async function download(domain: string): Promise<Image | null> {
  try {
    const response = await fetch(`${service}/${domain}.ico`, { signal: AbortSignal.timeout(8000) });
    const type = response.headers.get("content-type")?.split(";")[0].trim();
    if (!response.ok || !type || !/^image\/[\w.+-]+$/.test(type)) {
      await response.body?.cancel();
      return null;
    }
    const body = await readResponseBytes(response, maxBytes);
    return body.length ? { body, type } : null;
  } catch { return null; }
}

export async function companyLogo(value: string): Promise<Image | null> {
  const domain = logoDomain(value);
  if (!domain || domain.length > 253) return null;
  const file = path.join(cacheDir(), `${domain}.json`);
  const cached = memory.get(file);
  if (cached) return cached;
  if (misses.get(file)) return null;
  const existing = pending.get(file);
  if (existing) return existing;
  if (pending.size >= 36) return null;
  const work = limited(async () => {
    prepareImageCache(path.dirname(file));
    const onDisk = readCached(file);
    const fetched = onDisk?.fresh ? null : await download(domain);
    const image = fetched || onDisk?.image || null;
    if (fetched) writeCached(file, fetched);
    if (image) memory.set(file, image); else misses.set(file, true);
    return image;
  }).catch(() => null).finally(() => { pending.delete(file); });
  pending.set(file, work);
  return work;
}
