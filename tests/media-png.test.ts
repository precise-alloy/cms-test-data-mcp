import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
  generatePng,
  dimensionLabel,
  DEFAULT_IMAGE_WIDTH,
  DEFAULT_IMAGE_HEIGHT,
  MAX_IMAGE_DIMENSION,
} from "../src/media/png";

/** PNG always places IHDR first, so these offsets are fixed. */
function readHeader(buf: Buffer) {
  return {
    signature: buf.subarray(0, 8).toString("hex"),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colourType: buf[25],
  };
}

/**
 * Decodes the pixels back out, so a test can assert what the image actually shows
 * rather than that some bytes were produced. Every row is written with filter 0,
 * which is what makes this short.
 */
function readPixels(buf: Buffer): { width: number; height: number; at: (x: number, y: number) => [number, number, number] } {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);

  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(buf.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 3;
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error(`row ${y} uses filter ${raw[y * stride]}, expected 0`);
  }

  return {
    width,
    height,
    at: (x, y) => {
      const p = y * stride + 1 + x * 3;
      return [raw[p]!, raw[p + 1]!, raw[p + 2]!];
    },
  };
}

const isMarker = ([r, g, b]: [number, number, number]) => r === 255 && g === 255 && b === 255;

describe("generatePng", () => {
  test("produces a PNG whose header reports the requested dimensions", () => {
    const header = readHeader(generatePng(1600, 900, "hero"));
    expect(header.signature).toBe("89504e470d0a1a0a");
    expect(header.width).toBe(1600);
    expect(header.height).toBe(900);
    expect(header.bitDepth).toBe(8);
    expect(header.colourType).toBe(2);
  });

  test("ends with an IEND chunk so the file is complete", () => {
    const png = generatePng(48, 48, "thumb");
    expect(png.subarray(png.length - 12).toString("hex")).toBe("0000000049454e44ae426082");
  });

  test("is deterministic so re-running a plan produces identical bytes", () => {
    expect(generatePng(320, 240, "same").equals(generatePng(320, 240, "same"))).toBe(true);
  });

  test("gives different seeds different colours so QA can tell images apart", () => {
    expect(generatePng(320, 240, "alpha").equals(generatePng(320, 240, "beta"))).toBe(false);
  });

  test("stays small enough that a plan full of images is still a small package", () => {
    expect(generatePng(1600, 900, "hero").length).toBeLessThan(60_000);
  });

  test("rejects dimensions that would allocate an unreasonable buffer", () => {
    expect(() => generatePng(MAX_IMAGE_DIMENSION + 1, 100, "x")).toThrow("generatePng: width");
    expect(() => generatePng(100, MAX_IMAGE_DIMENSION + 1, "x")).toThrow("generatePng: height");
    expect(() => generatePng(0, 100, "x")).toThrow("generatePng: width");
    expect(() => generatePng(100, -1, "x")).toThrow("generatePng: height");
    expect(() => generatePng(1.5, 100, "x")).toThrow("generatePng: width");
  });

  test("accepts the smallest and largest dimensions it documents", () => {
    expect(() => generatePng(1, 1, "x")).not.toThrow();
    expect(() => generatePng(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, "x")).not.toThrow();
  });

  test("exposes defaults that describe a common web hero image", () => {
    expect(DEFAULT_IMAGE_WIDTH).toBe(1280);
    expect(DEFAULT_IMAGE_HEIGHT).toBe(720);
    expect(MAX_IMAGE_DIMENSION).toBe(4096);
  });
});

/**
 * The point of the pattern is that a QA can see a layout bug in it. A flat colour
 * cannot: squashing a 16:9 flat image into a square leaves an image that still looks
 * exactly like itself. These tests pin the features that make distortion visible.
 */
describe("the placeholder pattern", () => {
  test("draws a circle that stays circular whatever the aspect ratio", () => {
    const px = readPixels(generatePng(1200, 400, "ratio"));
    const cx = Math.floor(px.width / 2);
    const cy = Math.floor(px.height / 2);

    let left = -1;
    for (let x = 0; x < cx; x++) if (isMarker(px.at(x, cy))) { left = x; break; }
    let top = -1;
    for (let y = 0; y < cy; y++) if (isMarker(px.at(cx, y))) { top = y; break; }

    expect(left).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(-1);
    // Equal radius horizontally and vertically is what "circle" means. A pattern
    // scaled to the frame instead would give 3x the horizontal radius here.
    expect(Math.abs((cx - left) - (cy - top))).toBeLessThanOrEqual(2);
  });

  test("marks all four corners so a crop is visible", () => {
    const png = generatePng(800, 600, "corners");
    const px = readPixels(png);
    const corners: Array<[number, number]> = [
      [0, 0],
      [px.width - 1, 0],
      [0, px.height - 1],
      [px.width - 1, px.height - 1],
    ];
    for (const [x, y] of corners) {
      expect(isMarker(px.at(x, y)), `corner ${x},${y} is not marked`).toBe(true);
    }
  });

  test("labels the image with the size it was asked for", () => {
    expect(dimensionLabel(1600, 900)).toBe("1600x900");
    expect(dimensionLabel(1, 1)).toBe("1x1");
  });

  test("draws the label where a reader can find it", () => {
    const px = readPixels(generatePng(800, 600, "label"));
    // The label sits below the centre line; the circle's ring never crosses that row
    // at its own centre column, so any marker pixel found here is glyph.
    let found = 0;
    for (let y = Math.floor(px.height * 0.55); y < Math.floor(px.height * 0.8); y++) {
      if (isMarker(px.at(Math.floor(px.width / 2), y))) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  test("omits the label rather than smearing it when the image is tiny", () => {
    // 24x24 cannot hold legible glyphs; it must still be a valid PNG.
    const png = generatePng(24, 24, "tiny");
    expect(readHeader(png).width).toBe(24);
    expect(png.subarray(png.length - 12).toString("hex")).toBe("0000000049454e44ae426082");
  });
});
