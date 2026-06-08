'use strict';

// Generates assets/icon.png (32x32 RGBA) — a green circle on transparent —
// used for the tray icon and window icon. Run once: `node scripts/make-icon.js`.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SIZE = 32;

// CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Raw RGBA scanlines with filter byte 0.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
let o = 0;
const cx = (SIZE - 1) / 2;
const cy = (SIZE - 1) / 2;
const r = SIZE / 2 - 1.5;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x - cx, y - cy);
    let a = 0;
    if (d <= r) a = 255;
    else if (d <= r + 1) a = Math.round((r + 1 - d) * 255);
    raw[o++] = 70;  // R
    raw[o++] = 211; // G
    raw[o++] = 154; // B
    raw[o++] = a;   // A
  }
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
const idat = zlib.deflateSync(raw);

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('wrote assets/icon.png (' + png.length + ' bytes)');
