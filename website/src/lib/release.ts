import type { OsKey } from "./os";

// The latest published release, read from the public GitHub API once at
// build time and again in the browser so a newer release replaces the
// baked-in links. Every consumer falls back to the releases page when the
// read fails. Kept free of runtime imports so node --test can import it.
const latestUrl = "https://api.github.com/repos/collection-of-things/aggregate-mail/releases/latest";

export type Installer = "windows" | "mac-arm64" | "mac-x64" | "linux";

export type ReleaseAsset = { name: string; url: string; size: number; sha256: string | null };

export type LatestRelease = {
  version: string;
  publishedAt: string;
  assets: Partial<Record<Installer, ReleaseAsset>>;
};

const patterns: Record<Installer, RegExp> = {
  windows: /-win-x64\.exe$/i,
  "mac-arm64": /-mac-arm64\.dmg$/i,
  "mac-x64": /-mac-x64\.dmg$/i,
  linux: /-linux-x86_64\.appimage$/i,
};

export function parseRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== "object") return null;
  if (!("tag_name" in body) || typeof body.tag_name !== "string") return null;
  if (!("published_at" in body) || typeof body.published_at !== "string") return null;
  if (!("assets" in body) || !Array.isArray(body.assets)) return null;

  const assets: LatestRelease["assets"] = {};
  for (const asset of body.assets as unknown[]) {
    if (!asset || typeof asset !== "object") continue;
    if (!("name" in asset) || typeof asset.name !== "string") continue;
    if (!("browser_download_url" in asset) || typeof asset.browser_download_url !== "string") continue;
    if (!asset.browser_download_url.startsWith("https://github.com/")) continue;
    if (!("size" in asset) || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size < 0) continue;
    const digest = "digest" in asset && typeof asset.digest === "string" ? asset.digest : "";
    const sha = /^sha256:([0-9a-f]{64})$/i.exec(digest);
    for (const [key, pattern] of Object.entries(patterns) as [Installer, RegExp][]) {
      if (pattern.test(asset.name)) {
        assets[key] = {
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          sha256: sha ? sha[1].toLowerCase() : null,
        };
      }
    }
  }
  return { version: body.tag_name.replace(/^v/, ""), publishedAt: body.published_at, assets };
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const response = await fetch(latestUrl, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return parseRelease(await response.json());
  } catch {
    return null;
  }
}

let pending: Promise<LatestRelease | null> | undefined;

export function latestRelease(): Promise<LatestRelease | null> {
  return (pending ??= fetchLatestRelease());
}

export function installerFor(
  os: OsKey,
  hints: { arch?: string; gpu?: string }
): { installer: Installer; archKnown: boolean } {
  if (os === "windows") return { installer: "windows", archKnown: true };
  if (os === "linux") return { installer: "linux", archKnown: true };
  const arch = hints.arch?.toLowerCase() ?? "";
  if (arch === "arm" || arch === "arm64") return { installer: "mac-arm64", archKnown: true };
  if (arch === "x86" || arch === "x86_64") return { installer: "mac-x64", archKnown: true };
  const gpu = hints.gpu ?? "";
  if (/apple m\d/i.test(gpu)) return { installer: "mac-arm64", archKnown: true };
  if (/intel|amd|radeon|nvidia/i.test(gpu)) return { installer: "mac-x64", archKnown: true };
  // Safari reports "Apple GPU" for every Mac; Apple silicon is the safer guess.
  return { installer: "mac-arm64", archKnown: false };
}

// Best guess at the visitor's desktop. Phones and unknown systems get null.
export function detectOs(): OsKey | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.userAgentData?.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (/android|iphone|ipad/.test(platform)) return null;
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "mac";
  if (platform.includes("linux") || platform.includes("x11")) return "linux";
  return null;
}

// The OS plus the right installer for it. On macOS the architecture comes
// from userAgentData first, then the unmasked WebGL renderer; "Apple GPU"
// gives no answer, so the choice stays marked unknown.
export async function detectPlatform(): Promise<{ os: OsKey; installer: Installer; archKnown: boolean } | null> {
  const os = detectOs();
  if (!os) return null;
  if (os !== "mac") return { os, ...installerFor(os, {}) };

  let arch: string | undefined;
  try {
    const nav = navigator as Navigator & {
      userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
    };
    const values = await nav.userAgentData?.getHighEntropyValues?.(["architecture"]);
    arch = values?.architecture;
  } catch {
    // Fall through to the GPU hint.
  }

  let gpu: string | undefined;
  if (!arch) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      if (gl && info) {
        const value: unknown = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
        if (typeof value === "string") gpu = value;
      }
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // No GPU hint either.
    }
  }

  return { os, ...installerFor(os, { arch, gpu }) };
}

export const formatSize = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

export const shortSha = (sha: string) => `${sha.slice(0, 8)}…${sha.slice(-6)}`;
