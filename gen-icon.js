// Gera icon.ico (256x256, PNG embutido) para o atalho do BTC Radar. Sem dependencias.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const N = 256;
const px = Buffer.alloc(N * N * 4, 0);
const set = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  const na = a / 255, ia = 1 - na;
  px[i] = px[i] * ia + r * na; px[i + 1] = px[i + 1] * ia + g * na;
  px[i + 2] = px[i + 2] * ia + b * na; px[i + 3] = Math.max(px[i + 3], a);
};
const rrect = (x0, y0, w, h, rad, color, alpha = 255) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const dx = Math.max(x0 + rad - x, x - (x0 + w - 1 - rad), 0);
    const dy = Math.max(y0 + rad - y, y - (y0 + h - 1 - rad), 0);
    const d = Math.hypot(dx, dy);
    if (d <= rad) set(x, y, color, alpha * Math.min(1, rad - d + 1));
  }
};

const BG = [12, 17, 26], BORDER = [29, 38, 52];
const UP = [38, 208, 124], DOWN = [255, 77, 94], ACC = [53, 200, 255], AMBER = [247, 147, 26];

rrect(0, 0, N, N, 52, BORDER);           // moldura
rrect(4, 4, N - 8, N - 8, 48, BG);       // fundo

// barras de liquidez (esquerda): verdes embaixo, vermelhas em cima
const bars = [
  [44, 0.34, DOWN], [62, 0.52, DOWN], [80, 0.30, DOWN],
  [106, 0.62, UP], [124, 0.44, UP], [142, 0.26, UP]
];
for (const [y, w, c] of bars) rrect(34, y, Math.round(w * 150), 14, 6, c, 210);

// linha de preco subindo (direita)
const pts = [[34, 226], [70, 208], [104, 216], [140, 182], [174, 190], [208, 150]];
for (let i = 0; i < pts.length - 1; i++) {
  const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
  const steps = Math.hypot(x2 - x1, y2 - y1) * 2;
  for (let s = 0; s <= steps; s++) {
    const x = x1 + (x2 - x1) * s / steps, y = y1 + (y2 - y1) * s / steps;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++)
      if (ox * ox + oy * oy <= 9) set(Math.round(x) + ox, Math.round(y) + oy, ACC);
  }
}
// ponto laranja na ponta (BTC)
for (let y = -13; y <= 13; y++) for (let x = -13; x <= 13; x++) {
  const d = Math.hypot(x, y);
  if (d <= 13) set(208 + x, 150 + y, AMBER, d > 12 ? 140 : 255);
}

// ---- PNG ----
const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
]);

// ---- ICO (PNG embutido, Vista+) ----
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);

const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([ico, png]));
console.log('icon.ico', png.length + 22, 'bytes');
