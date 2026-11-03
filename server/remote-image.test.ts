import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { parse } from "./providers.js";

const image = "https://images.example.com/hero.gif";

test("remote image fallback fetches only images the email references, over pinned public DNS", { timeout: 60000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-remote-image-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 61).toString("base64");
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  const store = await import("./store.js");
  const { mountRemoteImage, remoteImageService, mailImageSources, remoteImageType } = await import("./remote-image.js");
  assert.equal(remoteImageType(200, { "content-type": "Image/PNG; charset=binary", "content-length": "10" }), "image/png");
  for (const [status, headers] of [[302, { "content-type": "image/png", location: "https://10.0.0.1/" }], [200, { "content-type": "image/svg+xml" }],
    [200, { "content-type": "text/html" }], [200, { "content-type": "image/gif", "content-encoding": "gzip" }],
    [200, { "content-type": "image/gif", "content-length": String(5 * 1024 * 1024 + 1) }]] as const)
    assert.equal(remoteImageType(status, headers), undefined, JSON.stringify([status, headers]));
  let calls = 0, fail = false, tried: string[] = [];
  let addresses = [{ address: "8.8.8.8", family: 4 }];
  const load = remoteImageService({
    resolve: async () => addresses,
    fetch: async (target, pinned, signal) => {
      calls++; tried.push(pinned.address);
      assert.equal(target.href, image); assert.equal(signal.aborted, false);
      if (fail || pinned.address === "2001:4860:4860::8888") throw new Error("refused");
      return { type: "image/gif", bytes: Buffer.from("GIF89a") };
    },
  });
  const account = { id: "a", email: "reader@example.com", provider: "imap" as const, credentials: {} };
  store.put("account", "a", account);
  const mail = await parse(account, "1", Buffer.from(["From: Sender <sender@example.com>", "To: reader@example.com", "", "Synthetic"].join("\r\n")), false);
  store.put("mail", mail.id, { ...mail, category: "other", relevance: 1, reason: "Update", archived: false, snoozedUntil: null,
    html: `<p>Hi</p><img src="${image}" alt="Hero"><img src="https://10.0.0.1/a.png">`, images: [{ src: "https://cdn.example.com/plain.png", alt: "" }] });
  assert.deepEqual([...mailImageSources(store.get("mail", mail.id)!)].sort(),
    ["https://cdn.example.com/plain.png", image], "raw IP image hosts are never sources");
  const app = express(); mountRemoteImage(app, load);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const request = (src: string, id = "a%3A1") => fetch(`http://127.0.0.1:${address.port}/api/messages/${id}/remote-image?src=${encodeURIComponent(src)}`);
  try {
    const loaded = await request(image);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers.get("content-type"), "image/gif");
    assert.equal(loaded.headers.get("x-content-type-options"), "nosniff");
    assert.equal(Buffer.from(await loaded.arrayBuffer()).toString(), "GIF89a");
    assert.equal(calls, 1);
    addresses = [{ address: "2001:4860:4860::8888", family: 6 }, { address: "8.8.8.8", family: 4 }]; tried = [];
    assert.equal((await request(image)).status, 200, "an unreachable first address falls back to the next checked one");
    assert.deepEqual(tried, ["2001:4860:4860::8888", "8.8.8.8"]);
    addresses = [{ address: "8.8.8.8", family: 4 }]; calls = 1;
    assert.equal((await request("https://images.example.com/other.gif")).status, 404, "an image the email does not reference is refused");
    assert.equal((await request(image, "a%3A2")).status, 404);
    assert.equal((await request("https://10.0.0.1/a.png")).status, 404, "a raw private address in the email is refused");
    for (const privateAddress of ["127.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"]) {
      addresses = [{ address: "8.8.8.8", family: 4 }, { address: privateAddress, family: privateAddress.includes(":") ? 6 : 4 }];
      assert.equal((await request(image)).status, 400, privateAddress);
    }
    assert.equal(calls, 1, "mixed public/private DNS never reaches the transport");
    addresses = [{ address: "8.8.8.8", family: 4 }]; fail = true;
    const failed = await request(image);
    assert.equal(failed.status, 502); assert.match((await failed.json()).error, /could not be loaded/);
    store.remove("account", "a");
    assert.equal((await request(image)).status, 404, "a removed account's mail is not fetched");
    assert.equal(calls, 2);
    store.put("account", "a", account);
    // Many refused images at once wait for one of six slots instead of failing,
    // and a reader that closes while waiting gives up its place.
    const queued = express();
    let running = 0, peak = 0, completed = 0;
    const releases: (() => void)[] = [];
    mountRemoteImage(queued, async (_source, signal) => {
      running++; peak = Math.max(peak, running);
      await new Promise<void>(resolve => releases.push(resolve));
      running--;
      // A closed reader's signal stops a real transport; count only fetches that finished for an open reader.
      if (signal?.aborted) throw new Error("aborted");
      completed++;
      return { type: "image/png", bytes: Buffer.from("PNG") };
    });
    const queue = queued.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => queue.once("listening", resolve));
    const port = (queue.address() as { port: number }).port;
    const get = (signal?: AbortSignal) => fetch(`http://127.0.0.1:${port}/api/messages/a%3A1/remote-image?src=${encodeURIComponent(image)}`, { signal });
    try {
      const leaving = new AbortController();
      const pending = Array.from({ length: 6 }, () => get());
      while (releases.length < 6) await new Promise(resolve => setTimeout(resolve, 10));
      const left = get(leaving.signal).catch(() => "aborted");
      pending.push(...Array.from({ length: 3 }, () => get()));
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(releases.length, 6, "requests beyond six wait instead of failing");
      leaving.abort();
      assert.equal(await left, "aborted");
      let done = false;
      const all = Promise.all(pending).finally(() => { done = true; });
      while (!done) { releases.shift()?.(); await new Promise(resolve => setTimeout(resolve, 5)); }
      await all;
      const results = await Promise.all(pending);
      assert.deepEqual(results.map(result => result.status), Array(9).fill(200));
      assert.equal(peak, 6);
      assert.equal(running, 0);
      assert.equal(completed, 9, "the closed waiting request is never served");
    } finally {
      releases.forEach(release => release());
      await new Promise<void>((resolve, reject) => queue.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.closeStore(); rmSync(directory, { recursive: true, force: true });
  }
});
