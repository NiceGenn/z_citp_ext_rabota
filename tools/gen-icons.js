// Генератор иконок для расширения ЦИТП
// Дизайн: бирюзовый фон + белый сертификат + серые строки + золотая медаль + красная лента
// Запуск: node ext/gen-icons.js

'use strict';
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

// ── CRC32 ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n) { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n); return b; }
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  return Buffer.concat([u32(data.length), tb, data, u32(crc32(Buffer.concat([tb, data])))]);
}

// ── Палитра ──
const TEAL   = [13,  148, 136, 255]; // #0d9488
const WHITE  = [255, 255, 255, 255];
const GREY   = [176, 186, 196, 255];
const GOLD_O = [251, 191,  36, 255]; // #fbbf24 — внешнее кольцо
const GOLD_I = [245, 158,  11, 255]; // #f59e0b — внутренний круг
const GOLD_C = [253, 211,  77, 255]; // #fdd34d — центр
const RED    = [220,  38,  38, 255]; // #dc2626
const TRANSP = [  0,   0,   0,   0];

// ── Помощник: внутри скруглённого прямоугольника? ──
function inRR(nx, ny, l, r, t, b, cr) {
  if (nx < l || nx > r || ny < t || ny > b) return false;
  if (nx < l+cr && ny < t+cr) return Math.hypot(nx-(l+cr), ny-(t+cr)) <= cr;
  if (nx > r-cr && ny < t+cr) return Math.hypot(nx-(r-cr), ny-(t+cr)) <= cr;
  if (nx < l+cr && ny > b-cr) return Math.hypot(nx-(l+cr), ny-(b-cr)) <= cr;
  if (nx > r-cr && ny > b-cr) return Math.hypot(nx-(r-cr), ny-(b-cr)) <= cr;
  return true;
}

// ── Пиксель (без AA) ──
function pixelRaw(nx, ny) {
  // Параметры медали
  const mCx = 0.675, mCy = 0.615;
  const mROut  = 0.230;
  const angle  = Math.atan2(ny - mCy, nx - mCx);
  const mDist  = Math.hypot(nx - mCx, ny - mCy);
  // Шестерённый ободок: 10 зубцов через cos
  const mRJag  = mROut * (0.800 + 0.095 * Math.cos(angle * 10));
  const mRBand = mROut * 0.720; // граница внешнего кольца
  const mRCore = mROut * 0.430; // радиус центра

  // 1. МЕДАЛЬ (поверх всего)
  if (mDist <= mROut) {
    if (mDist > mRJag)  return TEAL;   // просветы зубцов
    if (mDist > mRBand) return GOLD_O; // внешнее кольцо
    if (mDist > mRCore) return GOLD_I; // переходное кольцо
    return GOLD_C;                     // центр
  }

  // 2. ЛЕНТА (красная, ниже медали)
  {
    const rbTop = mCy + mROut * 0.65;
    const rbBot = 0.97;
    if (ny >= rbTop && ny <= rbBot) {
      const t  = (ny - rbTop) / (rbBot - rbTop);
      // Два хвоста расходятся вниз
      const lCx = mCx - 0.025 - t * 0.095;
      const rCx = mCx + 0.025 + t * 0.095;
      const hw  = 0.055 - t * 0.008;
      if (Math.abs(nx - lCx) <= hw || Math.abs(nx - rCx) <= hw) return RED;
    }
  }

  // 3. ФОНОВЫЙ прямоугольник (скруглённый)
  if (!inRR(nx, ny, 0.01, 0.99, 0.01, 0.99, 0.11)) return TRANSP;

  // 4. СЕРТИФИКАТ (белый, с рамкой тила)
  if (inRR(nx, ny, 0.09, 0.91, 0.09, 0.87, 0.07)) {
    const lL = 0.17, lR = 0.83, lHalf = 0.033;
    const lines = [0.22, 0.33, 0.43, 0.52, 0.61, 0.70];
    for (let i = 0; i < lines.length; i++) {
      const ly   = lines[i];
      const lineR = i === 0                 ? lL + (lR-lL) * 0.60  // первая строка короче
                  : i === lines.length - 1  ? lL + (lR-lL) * 0.40  // последняя — ещё короче
                  : lR;
      if (Math.abs(ny - ly) <= lHalf && nx >= lL && nx <= lineR) return GREY;
    }
    return WHITE;
  }

  // 5. БИРЮЗОВЫЙ ФОН
  return TEAL;
}

// ── 4x суперсэмплинг (анти-алиасинг) ──
const SUB = [[-0.25,-0.25],[0.25,-0.25],[-0.25,0.25],[0.25,0.25]];
function iconPixel(xi, yi, size) {
  const samples = SUB.map(([dx, dy]) => pixelRaw((xi+0.5+dx)/size, (yi+0.5+dy)/size));
  return [0,1,2,3].map(c => Math.round(samples.reduce((s,p) => s+p[c], 0) / 4));
}

// ── PNG-генератор ──
function generatePNG(size) {
  const SIG  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = pngChunk('IHDR', Buffer.concat([u32(size), u32(size), Buffer.from([8,6,0,0,0])]));

  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter: None
    for (let x = 0; x < size; x++) raw.push(...iconPixel(x, y, size));
  }

  const idat = pngChunk('IDAT', zlib.deflateSync(Buffer.from(raw), { level: 9 }));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([SIG, ihdr, idat, iend]);
}

// ── Запись ──
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png  = generatePNG(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`✓ icon${size}.png  (${png.length} bytes)`);
}
console.log('Готово: ext/icons/');
