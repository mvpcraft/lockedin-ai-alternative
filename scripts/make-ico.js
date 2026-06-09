'use strict';
// Combines the per-size PNGs in build/ into a single build/icon.ico.
// Modern Windows .ico files can embed PNG-compressed entries directly, so we
// just pack the existing PNGs into the ICO container. Run: `node scripts/make-ico.js`.
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const sizes = [256, 128, 64, 48, 32, 16];

const images = sizes.map((size) => {
  const file = path.join(buildDir, `icon-${size}.png`);
  const data = fs.readFileSync(file);
  // Read real dimensions from the PNG IHDR (bytes 16-23) to be safe.
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return { size, data, width, height };
});

const headerSize = 6;
const entrySize = 16;
const offsetStart = headerSize + entrySize * images.length;

// ICONDIR header
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(images.length, 4); // image count

const entries = [];
const blobs = [];
let offset = offsetStart;

for (const img of images) {
  const entry = Buffer.alloc(entrySize);
  // 256 is stored as 0 in the 1-byte width/height fields.
  entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
  entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
  entry.writeUInt8(0, 2); // palette count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(img.data.length, 8); // size of image data
  entry.writeUInt32LE(offset, 12); // offset of image data
  entries.push(entry);
  blobs.push(img.data);
  offset += img.data.length;
}

const ico = Buffer.concat([header, ...entries, ...blobs]);
const out = path.join(buildDir, 'icon.ico');
fs.writeFileSync(out, ico);
console.log(`wrote build/icon.ico (${ico.length} bytes, ${images.length} sizes)`);
