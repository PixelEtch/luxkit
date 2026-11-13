#!/usr/bin/env node
// Generates site/icons/*.png with no dependencies (Node zlib only).
// Design: ink background, signal-orange ring, small orange dot — the app's meter needle motif.
// Run: node tools/make-icons.js
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [0x15, 0x13, 0x0f];
const RING = [0xe2, 0x50, 0x1a];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Coverage of a pixel by a shape, 4x4 supersampled for smooth edges.
function cover(x, y, inside) {
  let hit = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hit++;
  return hit / 16;
}

function icon(size) {
  const c = size / 2;
  const rOuter = size * 0.34, rInner = size * 0.255, rDot = size * 0.07;
  const ring = (x, y) => { const d = Math.hypot(x - c, y - c); return d <= rOuter && d >= rInner; };
  const dot = (x, y) => Math.hypot(x - c, y - c) <= rDot;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = Math.min(1, cover(x, y, ring) + cover(x, y, dot));
      for (let k = 0; k < 3; k++) raw[o++] = Math.round(BG[k] + (RING[k] - BG[k]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, "..", "site", "icons");
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  fs.writeFileSync(path.join(out, name), icon(size));
  console.log("wrote", name, size + "px");
}
