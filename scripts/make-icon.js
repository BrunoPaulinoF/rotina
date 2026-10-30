'use strict';
/**
 * Gera os ícones do app (PNG + ICO) desenhando por código, sem dependências.
 * Uso: npm run icons
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// ---- desenho por SDF (coordenadas normalizadas 0..1) ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function render(size, variant) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  const top = hex(variant === 'paused' ? '#7E93A8' : '#1F4FD1');
  const bottom = hex(variant === 'paused' ? '#4B5B6B' : '#0E2A57');
  const accent = hex(variant === 'paused' ? '#D7DEE6' : '#F07A24');
  const tray = variant !== 'app';
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          let col = null;
          const bg = tray ? Math.hypot(x - 0.5, y - 0.5) - 0.49 : sdRoundRect(x, y, 0.5, 0.5, 0.46, 0.46, 0.2);
          if (bg <= 0) {
            const t = y;
            col = top.map((c, i) => c + (bottom[i] - c) * t);
            const ring = Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.27) - 0.045;
            const handH = sdSegment(x, y, 0.5, 0.5, 0.5, 0.32, 0.04);
            const handM = sdSegment(x, y, 0.5, 0.5, 0.64, 0.58, 0.04);
            const dot = Math.hypot(x - 0.5, y - 0.5) - 0.055;
            if (ring <= 0 || handH <= 0 || handM <= 0) col = [255, 255, 255];
            if (dot <= 0) col = accent;
          }
          if (col) {
            acc[0] += col[0];
            acc[1] += col[1];
            acc[2] += col[2];
            acc[3] += 255;
          }
        }
      }
      const n = ss * ss;
      const a = acc[3] / n;
      const o = (py * size + px) * 4;
      if (a > 0) {
        buf[o] = Math.round(acc[0] / (acc[3] / 255));
        buf[o + 1] = Math.round(acc[1] / (acc[3] / 255));
        buf[o + 2] = Math.round(acc[2] / (acc[3] / 255));
      }
      buf[o + 3] = Math.round(a);
    }
  }
  return encodePNG(size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
fs.writeFileSync(path.join(OUT, 'icon.ico'), encodeICO(sizes.map((size) => ({ size, data: render(size, 'app') }))));
fs.writeFileSync(path.join(OUT, 'icon.png'), render(256, 'app'));
fs.writeFileSync(path.join(OUT, 'tray.ico'), encodeICO([16, 20, 24, 32, 48].map((size) => ({ size, data: render(size, 'tray') }))));
fs.writeFileSync(path.join(OUT, 'tray-paused.ico'), encodeICO([16, 20, 24, 32, 48].map((size) => ({ size, data: render(size, 'paused') }))));
console.log('Ícones gerados em', OUT);
