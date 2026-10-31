import { githubDownloads } from "./downloads";

// Star count read in the browser from the public GitHub API, with the same
// ten-minute cache and hidden-on-failure behaviour as the download total.
const GITHUB_REPO = "collection-of-things/aggregate-mail";
const cacheMs = 10 * 60 * 1000;

let cached: { at: number; value: number | null } = { at: 0, value: null };

async function githubStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "emc2-site" },
    });
    if (res.ok) {
      const body = (await res.json()) as { stargazers_count?: unknown };
      if (typeof body.stargazers_count === "number") return body.stargazers_count;
    }
  } catch {
    // Fall through to the badge service.
  }
  try {
    const res = await fetch(`https://img.shields.io/github/stars/${GITHUB_REPO}.json`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { message?: unknown };
    const value = Number(body.message);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function siteCounts(): Promise<{ stars: number | null; downloads: number | null }> {
  const now = Date.now();
  const stars = now - cached.at < cacheMs ? cached.value : await githubStars();
  if (now - cached.at >= cacheMs) cached = { at: now, value: stars };
  const downloads = await githubDownloads();
  return { stars, downloads };
}
