// Generates build/icon.png (512x512) and build/icon.ico (16–256 px): an amber
// ring on a dark rounded square. Run with `npm run icon -w @studio/ide`; the
// output is committed, so packaging needs no image tooling.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = [27, 29, 35];
const accent = [232, 176, 74];

/** Renders the icon at `size` pixels, with geometry defined on a 512 px grid. */
function render(size) {
  const scale = size / 512;
  const center = size / 2;
  const corner = 96 * scale;
  const pixels = Buffer.alloc(size * size * 4);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const distance = Math.hypot(px - center, py - center);
      const ring = clamp(Math.min(distance - 120 * scale, 170 * scale - distance) + 0.5);
      const dot = clamp(40 * scale - distance + 0.5);
      const a = Math.max(ring, dot);
      const dx = Math.max(Math.abs(px - center) - (center - corner), 0);
      const dy = Math.max(Math.abs(py - center) - (center - corner), 0);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(background[c] * (1 - a) + accent[c] * a);
      pixels[i + 3] = Math.round(255 * clamp(corner - Math.hypot(dx, dy) + 0.5));
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function png(size) {
  const pixels = render(size);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const rows = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) pixels.copy(rows, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** ICO container holding PNG images (supported by Windows Vista and later). */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
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

mkdirSync(path.join(appDir, "build"), { recursive: true });
writeFileSync(path.join(appDir, "build", "icon.png"), png(512));
writeFileSync(path.join(appDir, "build", "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256]));
console.log("Wrote build/icon.png and build/icon.ico");
