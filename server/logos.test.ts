import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildIndex,
  companySvg,
  isFreeMail,
  matchDomain,
  normalizeDomain,
  registrableDomain,
  syncLogos,
  variantOf,
} from "./logos.js";

// A registry shaped like theSVG's, holding the cases that actually bite: a
// host hundreds of project pages share, a brand whose site is www-prefixed, an
// icon whose name only matches once punctuation is ignored, an alias with no
// site of its own, and a two-part suffix.
const icons = [
  {
    slug: "30-seconds-of-code",
    title: "30 seconds of code",
    aliases: [],
    url: "https://github.com/30-seconds/30-seconds-of-code",
    variants: ["default", "mono"],
  },
  {
    slug: "github",
    title: "GitHub",
    aliases: [],
    url: "https://github.com/",
    variants: ["default", "mono"],
  },
  {
    slug: "github-badge",
    title: "GitHub badge",
    aliases: [],
    url: "https://github.com/",
    variants: ["default"],
  },
  {
    slug: "google",
    title: "Google",
    aliases: ["구글"],
    url: "https://www.google.com/",
    variants: ["default", "color", "mono"],
  },
  {
    slug: "mail",
    title: "Mail",
    aliases: [],
    url: "https://mail.example.com/",
    variants: ["default"],
  },
  {
    slug: "figma",
    title: "Figma",
    aliases: [],
    url: "https://www.figma.com/",
    variants: ["default", "mono"],
  },
  {
    // The name the domain uses, under a host the domain does not.
    slug: "hugging-face",
    title: "Hugging Face",
    aliases: [],
    url: "https://hub.huggingface.co/",
    variants: ["default", "color"],
  },
  {
    slug: "linear",
    title: "",
    aliases: ["linear-app"],
    url: null,
    variants: ["default"],
  },
  {
    slug: "acme",
    title: "Acme",
    aliases: ["acme-corp"],
    url: "https://acme.co.uk/",
    variants: ["mono"],
  },
];
const index = buildIndex(icons);
const slug = (value: string) => matchDomain(index, value)?.slug ?? null;

// Each stub registry belongs to its own data directory, so no case here can
// read another one's cache. Nothing in this file touches the network.
const dataDirs: string[] = [];
const freshDataDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "am-logos-"));
  dataDirs.push(dir);
  return dir;
};
const use = (dir: string) => {
  process.env.MAIL_DATA_DIR = dir;
  return dir;
};
after(() => {
  for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true });
});

const respond = (t: { mock: { method: Function } }, handler: (url: string) => unknown) =>
  t.mock.method(globalThis, "fetch", (async (url: unknown) =>
    handler(String(url))) as unknown as typeof fetch);
const asRegistry = () => new Response(JSON.stringify({ icons }));
const asSvg = () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>');

test("a sender domain is normalised before it is matched", () => {
  assert.equal(normalizeDomain("Someone@GitHub.com"), "github.com");
  assert.equal(normalizeDomain("www.figma.com"), "figma.com");
  assert.equal(normalizeDomain("  mail.google.com.  "), "mail.google.com");
  // Not hostnames at all.
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("Name <a@acme.com>>"), null);
});

test("a registrable domain keeps a two-part suffix", () => {
  assert.equal(registrableDomain("github.com"), "github.com");
  assert.equal(registrableDomain("mail.google.com"), "google.com");
  assert.equal(registrableDomain("aws.amazon.com"), "amazon.com");
  assert.equal(registrableDomain("mail.acme.co.uk"), "acme.co.uk");
});

test("the brand's own host beats every other entry on that host", () => {
  // github.com is the site of hundreds of project pages, so only the entry
  // whose url is the bare origin and whose slug is the host label may win.
  assert.equal(slug("no-reply@github.com"), "github");
  assert.equal(slug("www.github.com"), "github");
});

test("a subdomain reaches the brand through its registrable domain", () => {
  assert.equal(slug("no-reply@mail.google.com"), "google");
  assert.equal(slug("accounts.google.com"), "google");
  // A brand entry hosted the same way still matches on its own host.
  assert.equal(slug("postmaster@mail.example.com"), "mail");
});

test("the subdomain's own label is never read as the brand", () => {
  // The fixture has an icon called mail, and mail.google.com is still Google.
  assert.equal(slug("mail.google.com"), "google");
});

test("a name match falls back to slug, then alias, then title", () => {
  // The domain huggingface.io carries the name the icon is filed under, even
  // though the icon's website is hub.huggingface.co.
  assert.equal(slug("news@huggingface.io"), "hugging-face");
  assert.equal(slug("invoice@mail.acme.co.uk"), "acme");
  // An alias answers when no slug does: linear-app is not linear.app.
  assert.equal(slug("www.linear-app.com"), "linear");
  assert.equal(slug("nothing@example.net"), null);
});

test("free mail hosts and unknown domains resolve to nothing", () => {
  for (const domain of [
    "gmail.com",
    "googlemail.com",
    "icloud.com",
    "me.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "proton.me",
    "protonmail.com",
    "fastmail.com",
    "gmx.de",
  ]) {
    assert.equal(normalizeDomain(domain), domain);
    assert.equal(isFreeMail(domain), true);
    assert.equal(matchDomain(index, `someone@${domain}`), null);
  }
  assert.equal(isFreeMail("github.com"), false);
  assert.equal(matchDomain(index, "someone@unknown-company.test"), null);
  assert.equal(matchDomain(index, "not-an-address"), null);
});

test("a variant the entry lists is preferred, in colour first", () => {
  const entry = (value: string) => matchDomain(index, value)!;
  assert.equal(variantOf(entry("huggingface.io")), "color");
  assert.equal(variantOf(entry("github.com")), "default");
  assert.equal(variantOf(entry("acme.co.uk")), "mono");
});

test("an unreadable registry falls back instead of failing", async (t) => {
  use(freshDataDir());
  respond(t, () => {
    throw new Error("offline");
  });
  assert.equal(await companySvg("no-reply@github.com"), null);
  assert.equal(await companySvg("billing@acme.co.uk"), null);
});

test("a known brand is fetched once and then served from disk", async (t) => {
  const dir = use(freshDataDir());
  const calls: string[] = [];
  respond(t, (url) => {
    calls.push(url);
    if (url.endsWith("/registry.json")) return asRegistry();
    if (url.includes("/google/")) return asSvg();
    return { ok: false, status: 404 };
  });

  const google = await companySvg("no-reply@mail.google.com");
  assert.equal(google?.type, "image/svg+xml");
  assert.match(google!.body.toString("utf8"), /^<svg/);
  // The variant preference picked colour, the only variant google lists here.
  assert.deepEqual(calls, [
    "https://thesvg.org/api/registry.json",
    "https://thesvg.org/icons/google/color.svg",
  ]);

  const file = path.join(dir, "logos", "mail.google.com.svg");
  assert.ok(existsSync(file), file);
  assert.equal(readFileSync(file, "utf8").startsWith("<svg"), true);

  // Second call: no new requests, and an unknown sender is not retried at all.
  assert.ok(await companySvg("no-reply@mail.google.com"));
  assert.equal(await companySvg("someone@unknown-company.test"), null);
  assert.equal(await companySvg("someone@gmail.com"), null);
  assert.equal(await companySvg("not-an-address"), null);
  assert.equal(calls.length, 2);
});

test("a scan reports what it found, missed and could not fetch", async (t) => {
  use(freshDataDir());
  respond(t, (url) => {
    if (url.endsWith("/registry.json")) return asRegistry();
    if (url.includes("/github/")) return asSvg();
    return { ok: false, status: 404 };
  });

  const summary = await syncLogos([
    "no-reply@github.com",
    "no-reply@github.com",
    "someone@unknown-company.test",
    "someone@figma.com",
  ]);
  // github appears twice and is scanned once, figma is in the registry but its
  // file comes back 404, and the last domain has no entry at all.
  assert.deepEqual(summary, { total: 3, found: 1, missing: 1, failed: 1 });
});

test("a scan of nothing is not an error", async () => {
  assert.deepEqual(await syncLogos([]), {
    total: 0,
    found: 0,
    missing: 0,
    failed: 0,
  });
});

test("parallel requests for one SVG share the registry and download", async (t) => {
  use(freshDataDir());
  let registryCalls = 0, iconCalls = 0;
  respond(t, async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url.endsWith("/registry.json")) { registryCalls++; return asRegistry(); }
    iconCalls++; return asSvg();
  });
  const images = await Promise.all(Array.from({ length: 12 }, () => companySvg("github.com")));
  assert.ok(images.every((image) => image?.type === "image/svg+xml"));
  assert.equal(registryCalls, 1); assert.equal(iconCalls, 1);
});

test("oversized chunked SVGs are cancelled and reported as failed", async (t) => {
  use(freshDataDir());
  let cancelled = false;
  respond(t, (url) => url.endsWith("/registry.json") ? asRegistry() : new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
    cancel() { cancelled = true; },
  })));
  assert.deepEqual(await syncLogos(["github.com"]), { total: 1, found: 0, missing: 0, failed: 1 });
  assert.equal(cancelled, true);
});

test("registry metadata cannot inject icon path components", () => {
  for (const slug of ["../escape", "with/slash", "x?query", "x#fragment"]) {
    assert.equal(matchDomain(buildIndex([{ slug, title: "GitHub", variants: ["default"], url: "https://github.com" }]), "github.com"), null);
  }
  const entry = matchDomain(buildIndex([{ slug: "github", variants: ["../../escape"], url: "https://github.com" }]), "github.com");
  assert.ok(entry); assert.equal(variantOf(entry), "default");
});

test("a rejected SVG refresh preserves the expired image on disk", async (t) => {
  const dir = use(freshDataDir());
  mkdirSync(path.join(dir, "logos"));
  const file = path.join(dir, "logos", "github.com.svg");
  const previous = '<svg xmlns="http://www.w3.org/2000/svg"><title>Previous</title></svg>';
  writeFileSync(file, previous); utimesSync(file, new Date(0), new Date(0));
  respond(t, (url) => url.endsWith("/registry.json") ? asRegistry() : new Response("not an image"));
  assert.equal((await companySvg("github.com"))?.body.toString(), previous);
  assert.equal(readFileSync(file, "utf8"), previous);
});
