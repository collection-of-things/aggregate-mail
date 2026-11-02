import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { assetMatches, energyMark } from "./brand-icons.mjs";

// Check the shipped desktop assets, including the source-quality failure that
// remains hidden when a large hard-edged PNG is merely resized into an ICO.
test("desktop icon has antialiased vector edges and transparent corners", async () => {
  const { data, info } = await sharp("build/icon.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  assert.equal(data[3], 0);
  const colours = new Set();
  for (let i = 0; i < data.length; i += 4) colours.add(data.subarray(i, i + 4).toString("hex"));
  assert.ok(colours.size > 64, `Expected antialiased edges, found only ${colours.size} colours`);
});

test("Windows ICO embeds full-resolution PNGs for small and large displays", async () => {
  const ico = await readFile("build/icon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = new Set();
  for (let n = 0; n < ico.readUInt16LE(4); n++) {
    const entry = 6 + n * 16;
    const width = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length);
    const image = await sharp(ico.subarray(offset, offset + length)).metadata();
    assert.equal(image.width, width);
    assert.equal(image.height, width);
    sizes.add(width);
  }
  for (const size of [16, 24, 32, 48, 64, 128, 256]) assert.ok(sizes.has(size), `Missing ${size}px icon`);
});

// Platform encoders can produce different bytes for the same pixels; the check
// must accept those and still reject stale artwork or a changed icon layout.
test("icon check accepts re-encoded pixels and rejects changed artwork", async () => {
  const png = await readFile("build/icon.png");
  const reencoded = await sharp(png).png({ compressionLevel: 1, adaptiveFiltering: false }).toBuffer();
  assert.ok(!reencoded.equals(png));
  assert.equal(await assetMatches("build/icon.png", reencoded, png), true);
  const changed = await sharp(png).negate({ alpha: false }).png().toBuffer();
  assert.equal(await assetMatches("build/icon.png", changed, png), false);
  assert.equal(await assetMatches("build/icon.png", null, png), false);

  const ico = await readFile("build/icon.ico");
  const fewerFrames = Buffer.from(ico);
  fewerFrames.writeUInt16LE(ico.readUInt16LE(4) - 1, 4);
  assert.equal(await assetMatches("build/icon.ico", fewerFrames, ico), false);
  assert.equal(await assetMatches("build/icon.ico", ico.subarray(0, ico.length - 16), ico), false);
  const icns = await readFile("build/icon.icns");
  assert.equal(await assetMatches("build/icon.icns", icns.subarray(0, icns.length - 16), icns), false);

  const svg = await readFile("build/icon.svg");
  assert.equal(await assetMatches("build/icon.svg", Buffer.from(`${svg}\n`), svg), false);
});

// Nearly transparent edge pixels store colour that barely shows; encoder
// rounding there must not fail the check, while a visible colour change must.
test("icon check tolerates edge rounding but rejects a visible colour shift", async () => {
  const png = await readFile("build/tray-icon.png");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const encode = (pixels) => sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const rounded = Buffer.from(data);
  let edges = 0;
  for (let i = 0; i < rounded.length; i += 4) {
    if (rounded[i + 3] === 0 || rounded[i + 3] >= 32) continue;
    edges++;
    // One level of alpha-weighted rounding moves the stored colour by about
    // 255 / alpha, far beyond the tolerance for a plain channel comparison.
    const step = Math.round(255 / rounded[i + 3]);
    for (let c = 0; c < 3; c++) rounded[i + c] = rounded[i + c] >= step ? rounded[i + c] - step : rounded[i + c] + step;
    if (edges % 2) rounded[i + 3] -= 1;
  }
  assert.ok(edges > 0, "the tray icon has soft edges");
  assert.equal(await assetMatches("build/tray-icon.png", await encode(rounded), png), true);
  const shifted = Buffer.from(data);
  for (let i = 0; i < shifted.length; i += 4) if (shifted[i + 3] === 255) shifted[i] = shifted[i] > 127 ? shifted[i] - 40 : shifted[i] + 40;
  assert.equal(await assetMatches("build/tray-icon.png", await encode(shifted), png), false);
});

test("repository logo recolour fails when the mark colour changes", async () => {
  const mark = await readFile("build/mark.svg");
  assert.match(energyMark(mark).toString(), /#A50685/);
  assert.throws(() => energyMark(Buffer.from(mark.toString().replace("#FFF3F2", "#FFFFFF"))), /no longer uses #FFF3F2/);
});
