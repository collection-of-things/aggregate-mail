import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
// Encoders and SIMD resampling may round differently on each platform and CPU.
// Rounding moves a channel by one or two levels; a visible source change, such
// as a colour or path edit, moves pixels much further.
const tolerance = 8;

// Rasterize each size from the vector, with supersampling for smooth curves.
async function raster(svg, size) {
  return sharp(svg, { density: 72 * size * 4 / 100 })
    .resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
}

// Windows chooses a resource by display size; each frame has its own PNG.
async function windowsIcon(icon, sizes) {
  const images = await Promise.all(sizes.map(size => raster(icon, size)));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

// ICNS uses big-endian chunk lengths and PNG representations through 1024px.
async function macIcon(icon) {
  const chunks = [];
  for (const [type, size] of [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]]) {
    const png = await raster(icon, size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(8 + png.length, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

// The repository avatar uses the standalone Energy mark, not the wordmark.
// Preserve the standalone paths from the existing mark, changing only its colour.
export function energyMark(mark) {
  const source = mark.toString();
  const recoloured = source.replace("#FFF3F2", "#A50685");
  if (recoloured === source) throw new Error("build/mark.svg no longer uses #FFF3F2; update the repository logo colour in scripts/brand-icons.mjs.");
  return Buffer.from(recoloured);
}

// Split an icon container into its PNG frames; other rasters are one frame.
function frames(relative, bytes) {
  if (relative.endsWith(".ico")) {
    if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) throw new Error("Not an ICO");
    return Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => {
      const entry = 6 + i * 16;
      const length = bytes.readUInt32LE(entry + 8);
      const offset = bytes.readUInt32LE(entry + 12);
      if (offset + length > bytes.length) throw new Error("Truncated ICO");
      return { key: bytes.subarray(entry, entry + 8).toString("hex"), png: bytes.subarray(offset, offset + length) };
    });
  }
  if (relative.endsWith(".icns")) {
    if (bytes.toString("latin1", 0, 4) !== "icns" || bytes.readUInt32BE(4) !== bytes.length) throw new Error("Not an ICNS");
    const list = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset + 4);
      if (length < 8 || offset + length > bytes.length) throw new Error("Truncated ICNS");
      list.push({ key: bytes.toString("latin1", offset, offset + 4), png: bytes.subarray(offset + 8, offset + length) });
      offset += length;
    }
    return list;
  }
  return [{ key: "", png: bytes }];
}

async function pixels(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// SVG copies and icon container layouts must match exactly. Raster frames match
// when their dimensions are equal and every channel is within the tolerance.
export async function assetMatches(relative, existing, expected) {
  if (!existing) return false;
  if (existing.equals(expected)) return true;
  if (relative.endsWith(".svg")) return false;
  try {
    const actual = frames(relative, existing);
    const wanted = frames(relative, expected);
    if (actual.length !== wanted.length) return false;
    for (let i = 0; i < wanted.length; i++) {
      if (actual[i].key !== wanted[i].key) return false;
      const [a, b] = await Promise.all([pixels(actual[i].png), pixels(wanted[i].png)]);
      if (a.width !== b.width || a.height !== b.height) return false;
      // Compare colour weighted by alpha: on a nearly transparent edge pixel a
      // one-level alpha rounding can swing the stored colour by up to 255, yet
      // the visible result barely changes.
      for (let j = 0; j < a.data.length; j += 4) {
        if (Math.abs(a.data[j + 3] - b.data[j + 3]) > tolerance) return false;
        for (let c = 0; c < 3; c++)
          if (Math.abs(a.data[j + c] * a.data[j + 3] - b.data[j + c] * b.data[j + 3]) / 255 > tolerance) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const icon = await readFile(path.join(root, "build/icon.svg"));
  const mark = await readFile(path.join(root, "build/mark.svg"));
  const outputs = new Map();
  const ico = await windowsIcon(icon, [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]);
  outputs.set("build/icon.png", await raster(icon, 1024));
  outputs.set("build/icon.ico", ico);
  outputs.set("build/icon.icns", await macIcon(icon));
  outputs.set("build/tray-icon.png", await raster(mark, 256));
  for (const prefix of ["public", "website/public"]) {
    outputs.set(`${prefix}/favicon.svg`, icon);
    outputs.set(`${prefix}/favicon.ico`, ico);
    outputs.set(`${prefix}/apple-touch-icon.png`, await raster(icon, 180));
  }
  outputs.set("public/favicon.png", await raster(icon, 256));
  outputs.set("public/brand/apple-touch-icon.png", await raster(icon, 180));
  outputs.set("public/brand/icon-192.png", await raster(icon, 192));
  outputs.set("website/public/icon-192.png", await raster(icon, 192));
  outputs.set("website/public/icon-512.png", await raster(icon, 512));
  outputs.set(".github/assets/emc2-repository-logo.png", await raster(energyMark(mark), 1024));

  let stale = 0;
  for (const [relative, bytes] of outputs) {
    const target = path.join(root, relative);
    if (check) {
      const existing = await readFile(target).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!await assetMatches(relative, existing, bytes)) { console.error(`Regenerate ${relative}`); stale++; }
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  if (stale) process.exitCode = 1;
  else console.log(`${check ? "Verified" : "Generated"} ${outputs.size} brand assets from SVG sources.`);
}

if (import.meta.main) await main();
