import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import express from "express";
import { z } from "zod";
import { embeddedImageTypes, parseMailContent, type MailContentNode } from "../shared/mail-content.js";
import { imageSource, type Mail } from "../shared/types.js";
import { publicUnsubscribeAddress, unsubscribeUrl } from "../shared/unsubscribe.js";
import { get } from "./store.js";

// Some senders mark their images Cross-Origin-Resource-Policy: same-origin, so
// a browser refuses them on any other site. After a direct load fails, the
// reader asks for the same image through this route (ADR 0121).
export const REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const REMOTE_IMAGE_REQUESTS = 6, REMOTE_IMAGE_WAITING = 64;

type Address = { address: string; family: number };
export type RemoteImage = { type: string; bytes: Buffer };
type Dependencies = {
  resolve: (host: string) => Promise<Address[]>;
  fetch: (url: URL, address: Address, signal: AbortSignal) => Promise<RemoteImage>;
};

class RemoteImageError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// Redirects are refused because their targets were never checked; only a
// plain bitmap body within the size limit is accepted.
export function remoteImageType(status: number | undefined, headers: { [name: string]: string | string[] | undefined }): string | undefined {
  const type = String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const length = Number(headers["content-length"] || 0);
  return status === 200 && embeddedImageTypes.has(type) && !headers["content-encoding"] && !(length > REMOTE_IMAGE_BYTES) ? type : undefined;
}

export const fetchRemoteImage: Dependencies["fetch"] = (url, address, signal) => new Promise((resolve, reject) => {
  // The hostname stays intact for TLS verification and SNI; DNS is pinned to
  // the address that passed the public-address check.
  const outgoing = request(url, {
    method: "GET", agent: false, family: address.family, signal, timeout: 10000, maxHeaderSize: 16384,
    lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8", "User-Agent": "Mozilla/5.0" },
  }, response => {
    const type = remoteImageType(response.statusCode, response.headers);
    if (!type) {
      response.destroy();
      return reject(new Error("Remote image refused"));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > REMOTE_IMAGE_BYTES) response.destroy(new Error("Remote image limit"));
      else chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => resolve({ type, bytes: Buffer.concat(chunks) }));
    response.on("close", () => { if (!response.complete) reject(new Error("Remote image closed")); });
  });
  outgoing.on("error", reject);
  outgoing.on("timeout", () => outgoing.destroy(new Error("Remote image timeout")));
  outgoing.end();
});

// Only an image the email itself references can be fetched, never an arbitrary URL.
export function mailImageSources(mail: Pick<Mail, "html" | "images">): Set<string> {
  const sources = new Set<string>();
  const add = (value: string | undefined) => { const src = imageSource(value || ""); if (src) sources.add(src); };
  const visit = (nodes: readonly MailContentNode[]) => {
    for (const node of nodes) if (typeof node !== "string") {
      if (node.tag === "img") add(node.attributes.src);
      visit(node.children);
    }
  };
  if (mail.html) visit(parseMailContent(mail.html) || []);
  for (const image of mail.images || []) add(image.src);
  return sources;
}

export function remoteImageService(dependencies: Dependencies = {
  resolve: host => lookup(host, { all: true, verbatim: true }), fetch: fetchRemoteImage,
}) {
  return async (source: string, cancel?: AbortSignal): Promise<RemoteImage> => {
    const url = unsubscribeUrl(source);
    if (!url) throw new RemoteImageError(400, "Only public HTTPS images can be loaded.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const signal = cancel ? AbortSignal.any([cancel, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    let onAbort: (() => void) | undefined;
    try {
      const addresses = await Promise.race([
        isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : dependencies.resolve(host),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error("Remote image timeout"));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      if (!addresses.length || addresses.some(address => !isIP(address.address) || !publicUnsubscribeAddress(address.address)))
        throw new RemoteImageError(400, "This image is on a private, local or reserved network.");
      // Every answer passed the check; try them in order, as a browser falls back
      // from an unreachable IPv6 address.
      let failure: unknown;
      for (const address of addresses) {
        signal.throwIfAborted();
        try { return await dependencies.fetch(url, address, signal); } catch (error) { failure = error; }
      }
      throw failure;
    } catch (error) {
      if (error instanceof RemoteImageError) throw error;
      throw new RemoteImageError(502, "The image could not be loaded.");
    } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
  };
}

export function mountRemoteImage(app: express.Express, load = remoteImageService()) {
  // Image-heavy mail can fail many direct loads at once; extra requests wait
  // for a slot instead of failing, and a closed reader releases its place.
  let active = 0;
  const waiting: (() => void)[] = [];
  // A finished request hands its slot straight to the next waiting one.
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
  app.get<{ id: string }>("/api/messages/:id/remote-image", async (req, res) => {
    const src = z.string().min(1).max(2048).safeParse(req.query.src);
    const mail = get("mail", req.params.id);
    if (!src.success || !mail || !get("account", mail.accountId)) return res.status(404).json({ error: "Image unavailable." });
    const source = imageSource(src.data);
    if (!source || !mailImageSources(mail).has(source)) return res.status(404).json({ error: "This email does not contain that image." });
    if (active >= REMOTE_IMAGE_REQUESTS && waiting.length >= REMOTE_IMAGE_WAITING)
      return res.status(429).json({ error: "Too many images are loading. Try again shortly." });
    const closed = new AbortController();
    res.once("close", () => { if (!res.writableEnded) closed.abort(); });
    if (active >= REMOTE_IMAGE_REQUESTS) {
      const turn = await new Promise<boolean>((resolve) => {
        const ready = () => { closed.signal.removeEventListener("abort", leave); resolve(true); };
        const leave = () => { waiting.splice(waiting.indexOf(ready), 1); resolve(false); };
        waiting.push(ready);
        closed.signal.addEventListener("abort", leave, { once: true });
      });
      if (!turn) return;
    } else active++;
    if (closed.signal.aborted || req.socket.destroyed) return release();
    try {
      const image = await load(source, closed.signal);
      res.set({
        "Content-Type": image.type, "Content-Length": String(image.bytes.length), "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
      }).send(image.bytes);
    } catch (error) {
      if (!closed.signal.aborted) res.status(error instanceof RemoteImageError ? error.status : 502).json({ error: error instanceof RemoteImageError ? error.message : "The image could not be loaded." });
    } finally { release(); }
  });
}
