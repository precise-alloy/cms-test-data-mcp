import { deflateSync } from "node:zlib";

export const DEFAULT_IMAGE_WIDTH = 1280;
export const DEFAULT_IMAGE_HEIGHT = 720;

/**
 * The raw pixel buffer is height * (1 + width * 3) bytes before compression:
 * 4096 squared is about 50 MB, 10000 squared about 300 MB, 20000 squared about 1.2 GB.
 * 4096 covers every realistic web image including 4K.
 */
export const MAX_IMAGE_DIMENSION = 4096;

/**
 * Total pixel budget across all media items in a single plan.
 * 128 000 000 ≈ 139 default 1280×720 images, or 8 at the maximum 4096×4096 dimension.
 */
export const MAX_IMAGE_PIXELS = 128_000_000;

/**
 * Ceiling on the number of items a plan may expand to, checked before expansion.
 * A test-data plan for one ticket is a handful of items; 5 000 is far past that and
 * still expands in well under a second.
 */
export const MAX_PLAN_ITEMS = 5_000;

type Channels = [number, number, number];

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reserved for the features a reader measures against. Decoration never uses it. */
const MARKER: Channels = [255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** FNV-1a. Any stable hash works; this one is short and needs no dependency. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Mid-range channels only, so a placeholder is never near-black or near-white. */
function colourFor(seed: string): Channels {
  const h = hash(seed);
  return [60 + (h & 0x7f), 60 + ((h >>> 8) & 0x7f), 60 + ((h >>> 16) & 0x7f)];
}

function requireDimension(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_IMAGE_DIMENSION) {
    throw new Error(
      `generatePng: ${label} must be an integer between 1 and ${MAX_IMAGE_DIMENSION}, got ${value}`
    );
  }
}

/** The text stamped on the image, naming the size the plan asked for. */
export function dimensionLabel(width: number, height: number): string {
  return `${width}x${height}`;
}

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** 5x7 bitmap glyphs, one 5-bit row per entry, covering only what a size label needs. */
const GLYPHS: Record<string, readonly number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  x: [0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b00000],
};

function fill(px: Buffer, width: number, height: number, x0: number, y0: number, size: number): void {
  for (let y = Math.max(0, y0); y < y0 + size && y < height; y++) {
    for (let x = Math.max(0, x0); x < x0 + size && x < width; x++) {
      const p = (y * width + x) * 3;
      px[p] = MARKER[0];
      px[p + 1] = MARKER[1];
      px[p + 2] = MARKER[2];
    }
  }
}

/**
 * Writes the size label below the centre line. Skipped when the image is too small to
 * hold legible glyphs: an unreadable smear is worse than no label, and a 48x48
 * thumbnail has nowhere to put one.
 */
function stampLabel(
  px: Buffer,
  width: number,
  height: number,
  cy: number,
  radius: number
): void {
  const scale = Math.round(Math.min(width, height) / 90);
  if (scale < 2) return;

  const text = dimensionLabel(width, height);
  const advance = (GLYPH_WIDTH + 1) * scale;
  const textWidth = text.length * advance - scale;
  const textHeight = GLYPH_HEIGHT * scale;
  if (textWidth > width * 0.9 || textHeight > height * 0.25) return;

  const left = Math.round((width - textWidth) / 2);
  const top = Math.round(cy + radius * 0.45);
  if (top + textHeight >= height) return;

  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPHS[text[i]!];
    if (!glyph) continue;
    const originX = left + i * advance;
    for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
      const bits = glyph[gy]!;
      for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
        if ((bits & (1 << (GLYPH_WIDTH - 1 - gx))) === 0) continue;
        fill(px, width, height, originX + gx * scale, top + gy * scale, scale);
      }
    }
  }
}

/**
 * A diagnostic pattern rather than a flat colour, because a flat colour cannot show the
 * bug a QA is looking for: squash a flat 16:9 image into a square and the result still
 * looks exactly like itself. Each feature answers one question.
 *
 * - circle, sized by the SHORT side: becomes an ellipse as soon as the aspect ratio is
 *   not preserved
 * - square grid: cells become rectangles under the same distortion, and are countable
 * - corner brackets: any that are missing mean the image was cropped
 * - centre cross: shows where the middle landed under a crop or an off-centre focal point
 * - size label: names the source size, so a wrong rendition shows without opening the asset
 */
function renderPattern(width: number, height: number, seed: string): Buffer {
  const base = colourFor(seed);
  const short = Math.min(width, height);
  // Capped clear of MARKER so a reader can tell a measurable feature from decoration.
  const light: Channels = [
    Math.min(235, base[0] + 55),
    Math.min(235, base[1] + 55),
    Math.min(235, base[2] + 55),
  ];
  const dark: Channels = [
    Math.max(0, base[0] - 45),
    Math.max(0, base[1] - 45),
    Math.max(0, base[2] - 45),
  ];

  const px = Buffer.alloc(width * height * 3);
  const cx = width / 2;
  const cy = height / 2;
  const radius = short * 0.36;
  const ring = Math.max(2, Math.round(short * 0.012));
  const inner = (radius - ring) ** 2;
  const outer = (radius + ring) ** 2;
  const cell = Math.max(16, Math.round(short / 8));
  const bracket = Math.round(short * 0.1);
  const thick = Math.max(2, Math.round(short * 0.012));

  // Squared distances, precomputed per column: a hypot per pixel costs seconds at 4096².
  const dx2 = new Float64Array(width);
  for (let x = 0; x < width; x++) dx2[x] = (x - cx) ** 2;

  for (let y = 0; y < height; y++) {
    const dy2 = (y - cy) ** 2;
    const nearTop = y < bracket;
    const nearBottom = y >= height - bracket;
    const edgeY = y < thick || y >= height - thick;
    const onGridRow = y % cell < 1;
    const onCrossRow = Math.abs(y - cy) < thick / 2;
    const row = y * width * 3;

    for (let x = 0; x < width; x++) {
      let c: Channels = base;
      if (onGridRow || x % cell < 1) c = dark;
      if (onCrossRow || Math.abs(x - cx) < thick / 2) c = light;

      const d2 = dx2[x]! + dy2;
      if (d2 > inner && d2 < outer) c = MARKER;

      const edgeX = x < thick || x >= width - thick;
      if (((x < bracket || x >= width - bracket) && edgeY) || ((nearTop || nearBottom) && edgeX)) {
        c = MARKER;
      }

      const p = row + x * 3;
      px[p] = c[0];
      px[p + 1] = c[1];
      px[p + 2] = c[2];
    }
  }

  stampLabel(px, width, height, cy, radius);
  return px;
}

export function generatePng(width: number, height: number, seed: string): Buffer {
  requireDimension("width", width);
  requireDimension("height", height);

  const pixels = renderPattern(width, height, seed);

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type: None
    pixels.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  // bytes 10-12 stay zero: deflate compression, adaptive filtering, no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
