import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function stampBrowserBuild(directory) {
  const file = path.join(directory, "index.html");
  const html = (await readFile(file, "utf8")).replace(/<meta name="emc2-build" content="[a-f0-9]{64}">/g, "");
  const id = createHash("sha256").update(html).digest("hex");
  if (!html.includes("</head>")) throw new Error("Browser HTML has no head.");
  await writeFile(file, html.replace("</head>", `<meta name="emc2-build" content="${id}"></head>`));
  return id;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
await build({ entryPoints: ["src/phone-auth.ts"], outfile: "dist/auth-passkey.js", bundle: true, platform: "browser", target: "es2022", minify: true });
await stampBrowserBuild("dist");
}
