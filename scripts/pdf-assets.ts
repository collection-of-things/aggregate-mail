import type { Plugin } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// PDF.js requests these by name at runtime; Vite cannot discover them as imports.
export function pdfAssets(): Plugin {
  const files = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    const root = new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url);
    for (const name of readdirSync(root)) files.set(`pdfjs/${directory}/${name}`, fileURLToPath(new URL(name, root)));
  }
  return {
    name: "local-pdf-assets",
    generateBundle() {
      for (const [fileName, filename] of files) this.emitFile({ type: "asset", fileName, source: readFileSync(filename) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const filename = files.get(req.url?.slice(1) || "");
        if (!filename) return next();
        res.setHeader("Content-Type", filename.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(filename));
      });
    },
  };
}
