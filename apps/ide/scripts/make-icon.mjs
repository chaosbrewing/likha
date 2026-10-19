// Generates the app icon from build/logo.webp:
//   build/icon.png        512 px, for packaging and the window icon
//   build/icon.ico        16–256 px, for the Windows executable and installer
//   src/assets/logo.png   256 px, shown in the interface
//
// Runs under Electron (npm run icon -w @studio/ide) because Chromium decodes
// WebP and resizes with good quality; Node.js alone cannot. The logo's white
// background is made transparent by a flood fill from the edges, so white
// highlights inside the artwork are kept. The outputs are committed, so
// packaging needs no image tooling.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app } from "electron";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

const RENDER = `
async (source, sizes) => {
  const image = new Image();
  image.src = source;
  await image.decode();
  const w = image.naturalWidth, h = image.naturalHeight;
  const full = document.createElement("canvas");
  full.width = w; full.height = h;
  const ctx = full.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // Flood fill from the edges through near-white pixels; those become transparent,
  // with a soft edge so anti-aliased borders stay smooth.
  const SOLID = 250, SOFT = 200;
  const minChannel = (i) => Math.min(px[i], px[i + 1], px[i + 2]);
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    const i = p * 4;
    if (minChannel(i) < SOFT) continue;
    seen[p] = 1;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    if (!seen[p]) continue;
    const i = p * 4;
    const m = minChannel(i);
    const alpha = m >= SOLID ? 0 : Math.round(255 * (SOLID - m) / (SOLID - SOFT));
    px[i + 3] = Math.min(px[i + 3], alpha);
    if (alpha === 0) cleared++;
  }
  ctx.putImageData(data, 0, 0);

  // Crop to the artwork plus a small margin, then square it.
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const side = Math.max(maxX - minX, maxY - minY) + 1;
  const margin = Math.round(side * 0.04);
  const box = side + margin * 2;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const square = document.createElement("canvas");
  square.width = box; square.height = box;
  square.getContext("2d").drawImage(full, Math.round(cx - box / 2), Math.round(cy - box / 2), box, box, 0, 0, box, box);

  const out = {};
  for (const size of sizes) {
    // Downscale in halving steps for quality, as browsers do not filter large ratios well.
    let current = square;
    while (current.width / 2 >= size) {
      const half = document.createElement("canvas");
      half.width = half.height = Math.round(current.width / 2);
      const c = half.getContext("2d");
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(current, 0, 0, half.width, half.height);
      current = half;
    }
    const target = document.createElement("canvas");
    target.width = target.height = size;
    const c = target.getContext("2d");
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    c.drawImage(current, 0, 0, size, size);
    out[size] = target.toDataURL("image/png").split(",")[1];
  }
  return { source: { width: w, height: h }, cleared, crop: { minX, minY, maxX, maxY, box }, images: out };
}`;

/** ICO container holding PNG images (supported by Windows Vista and later). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

app.whenReady().then(async () => {
  try {
    const source = readFileSync(path.join(appDir, "build", "logo.webp"));
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL("data:text/html,<title>icon</title>");
    const result = await win.webContents.executeJavaScript(
      `(${RENDER})(${JSON.stringify(`data:image/webp;base64,${source.toString("base64")}`)}, ${JSON.stringify(SIZES)})`
    );
    win.destroy();

    const png = (size) => Buffer.from(result.images[size], "base64");
    mkdirSync(path.join(appDir, "build"), { recursive: true });
    mkdirSync(path.join(appDir, "src", "assets"), { recursive: true });
    writeFileSync(path.join(appDir, "build", "icon.png"), png(512));
    writeFileSync(path.join(appDir, "build", "icon.ico"), ico(SIZES.filter((s) => s <= 256).map((size) => ({ size, data: png(size) }))));
    writeFileSync(path.join(appDir, "src", "assets", "logo.png"), png(256));
    console.log(
      `Source ${result.source.width}x${result.source.height}, background pixels cleared: ${result.cleared}, ` +
        `crop ${result.crop.minX},${result.crop.minY}-${result.crop.maxX},${result.crop.maxY} (box ${result.crop.box}).\n` +
        "Wrote build/icon.png, build/icon.ico and src/assets/logo.png"
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
