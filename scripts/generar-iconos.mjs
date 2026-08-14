import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const TEAL = [14, 165, 233, 255];
const WHITE = [255, 255, 255, 255];

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const nx = Math.max(x0 + r - x, x - (x1 - r), 0);
  const ny = Math.max(y0 + r - y, y - (y1 - r), 0);
  return nx * nx + ny * ny <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function drawIcon(S) {
  const px = Buffer.alloc(S * S * 4);
  const sheet = { x0: 0.215 * S, y0: 0.137 * S, x1: 0.785 * S, y1: 0.84 * S, r: 0.055 * S };
  const holes = [
    [0.293 * S, 0.234 * S, 0.027 * S],
    [0.5 * S, 0.234 * S, 0.027 * S],
    [0.707 * S, 0.234 * S, 0.027 * S],
  ];
  const vBar = { x0: 0.441 * S, x1: 0.559 * S, y0: 0.459 * S, y1: 0.635 * S };
  const hBar = { x0: 0.412 * S, x1: 0.588 * S, y0: 0.488 * S, y1: 0.605 * S };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let color = TEAL;
      if (insideRoundedRect(x, y, sheet.x0, sheet.y0, sheet.x1, sheet.y1, sheet.r)) {
        color = WHITE;
        if (holes.some(([cx, cy, r]) => inCircle(x, y, cx, cy, r))) color = TEAL;
        const enV = x >= vBar.x0 && x <= vBar.x1 && y >= vBar.y0 && y <= vBar.y1;
        const enH = y >= hBar.y0 && y <= hBar.y1 && x >= hBar.x0 && x <= hBar.x1;
        if (enV || enH) color = TEAL;
      }
      const i = (y * S + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = color[3];
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
for (const size of [512, 192, 180]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, png(size, size, drawIcon(size)));
  console.log(`Generado ${file} (${size}x${size})`);
}
