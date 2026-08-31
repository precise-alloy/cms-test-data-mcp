import { describe, expect, test } from "bun:test";
import { validatePlan } from "../src/plan/validate";
import type { ContentPlan } from "../src/plan/types";
import type { SchemaIndex } from "../src/schema/types";

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    ImageFile: {
      id: 20, guid: "img-guid", name: "ImageFile", displayName: "Image",
      base: "Image", kind: "media", properties: [],
    },
    GenericMedia: {
      id: 21, guid: "gen-guid", name: "GenericMedia", displayName: "Generic",
      base: "Media", kind: "media", properties: [],
    },
    ArticlePage: {
      id: 10, guid: "page-guid", name: "ArticlePage", displayName: "Article",
      base: "Page", kind: "page", properties: [],
    },
    VideoMedia: {
      id: 22, guid: "vid-guid", name: "VideoMedia", displayName: "Video",
      base: "Video", kind: "media", properties: [],
    },
    PngDeclaredMedia: {
      id: 23, guid: "png-guid", name: "PngDeclaredMedia", displayName: "PNG Declared",
      base: "Media", kind: "media", properties: [],
      supportedMediaExtensions: "<string>jpg</string><string>png</string><string>gif</string>",
    },
    MpegOnlyMedia: {
      id: 24, guid: "mpg-guid", name: "MpegOnlyMedia", displayName: "MPEG Only",
      base: "Media", kind: "media", properties: [],
      supportedMediaExtensions: "<string>mp4</string><string>apng</string>",
    },
  },
};

const errors = (plan: ContentPlan) => validatePlan(plan, schema).filter((d) => d.level === "error");
const warnings = (plan: ContentPlan) => validatePlan(plan, schema).filter((d) => d.level === "warning");

describe("a plan that creates media", () => {
  test("accepts a media item with explicit dimensions", () => {
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.png", image: { width: 1600, height: 900 } },
    ]})).toEqual([]);
  });

  test("accepts a media item with no image field, which takes the default size", () => {
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.png" },
    ]})).toEqual([]);
  });

  test("rejects an image field on a type that is not media", () => {
    const found = errors({ planId: "p", items: [
      { key: "a", type: "ArticlePage", name: "Article", image: { width: 100, height: 100 } },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("ArticlePage is not a media type");
  });

  test("rejects a dimension above the encoder limit", () => {
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.png", image: { width: 99999, height: 10 } },
    ]}).length).toBeGreaterThan(0);
  });

  test("rejects a dimension that is zero or negative", () => {
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.png", image: { width: 0, height: 10 } },
    ]}).length).toBeGreaterThan(0);
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.png", image: { height: -5 } },
    ]}).length).toBeGreaterThan(0);
  });

  test("warns when the name suggests a format the generator does not produce", () => {
    const found = warnings({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.jpg" },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain(".png");
  });

  test("stays silent when the name already ends in .png or has no extension", () => {
    expect(warnings({ planId: "p", items: [
      { key: "a", type: "ImageFile", name: "hero.png" },
      { key: "b", type: "ImageFile", name: "Hero banner" },
    ]})).toEqual([]);
  });

  test("warns that thumbnail generation is unproven for a non-Image media base", () => {
    const found = warnings({ planId: "p", items: [
      { key: "doc", type: "GenericMedia", name: "spec.png" },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("thumbnail");
  });

  test("rejects a url segment the CMS reserves, whatever its casing", () => {
    for (const segment of ["globalassets", "SiteAssets", "contentassets"]) {
      const found = errors({ planId: "p", items: [
        { key: "a", type: "ArticlePage", name: "Article", urlSegment: segment },
      ]});
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("reserved");
    }
  });
});

describe("png-capability decision table", () => {
  test("case 1: rejects a type whose declared extensions do not include png", () => {
    // MpegOnlyMedia has supportedMediaExtensions with mp4 and apng but not png
    const found = errors({ planId: "p", items: [
      { key: "vid", type: "MpegOnlyMedia", name: "clip.mp4" },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("does not include png");
  });

  test("case 1: apng in extensions does not satisfy the png token requirement", () => {
    const found = errors({ planId: "p", items: [
      { key: "vid", type: "MpegOnlyMedia", name: "clip.png" },
    ]});
    expect(found.some((d) => d.message.includes("does not include png"))).toBe(true);
  });

  test("case 2: accepts a type whose declared extensions include png", () => {
    expect(errors({ planId: "p", items: [
      { key: "img", type: "PngDeclaredMedia", name: "photo.png" },
    ]})).toEqual([]);
  });

  test("case 3: accepts an Image-based type with no declared extensions", () => {
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero.png" },
    ]})).toEqual([]);
  });

  test("case 4: rejects a Video-based type with no declared extensions", () => {
    const found = errors({ planId: "p", items: [
      { key: "vid", type: "VideoMedia", name: "clip.mp4" },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("Video");
    expect(found[0]!.message).toContain("cannot hold a still PNG");
  });

  test("case 5: warns for a Media-based type with no declared extensions", () => {
    const found = warnings({ planId: "p", items: [
      { key: "doc", type: "GenericMedia", name: "spec.png" },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("thumbnail");
  });
});

describe("count cap", () => {
  test("rejects count above 1000", () => {
    const found = errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero-{{i}}.png", count: 1001 },
    ]});
    expect(found.length).toBeGreaterThan(0);
  });

  test("accepts count of exactly 1000", () => {
    // 1000 items × 1×1 pixel = 1 000 pixels, well under the pixel budget
    expect(errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
    ]})).toEqual([]);
  });
});

describe("plan item expansion cap", () => {
  test("rejects a plan whose declared item count exceeds MAX_PLAN_ITEMS", () => {
    const found = errors({ planId: "p", items: [
      { key: "img1", type: "ImageFile", name: "hero-1-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img2", type: "ImageFile", name: "hero-2-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img3", type: "ImageFile", name: "hero-3-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img4", type: "ImageFile", name: "hero-4-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img5", type: "ImageFile", name: "hero-5-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img6", type: "ImageFile", name: "hero-6-{{i}}.png", count: 1, image: { width: 1, height: 1 } },
    ]});
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("plan expands to 5,001 items");
    expect(found[0]!.message).toContain("limit is 5,000");
  });

  test("accepts a plan whose expanded item count is exactly at MAX_PLAN_ITEMS", () => {
    const found = errors({ planId: "p", items: [
      { key: "img1", type: "ImageFile", name: "hero-1-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img2", type: "ImageFile", name: "hero-2-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img3", type: "ImageFile", name: "hero-3-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img4", type: "ImageFile", name: "hero-4-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img5", type: "ImageFile", name: "hero-5-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
    ]});
    expect(found).toEqual([]);
  });

  test("default count of 1 counts toward the item expansion cap", () => {
    const items = Array.from({ length: 5001 }, (_, i) => ({
      key: `item-${i}`,
      type: "ImageFile",
      name: `img-${i}.png`,
      image: { width: 1, height: 1 },
    }));
    const found = errors({ planId: "p", items });
    expect(found.some((d) => d.message.includes("plan expands to 5,001 items"))).toBe(true);
  });
});

describe("pixel budget", () => {
  // 8 items × 4096×4096 = 134 217 728 > 128 000 000
  test("rejects a plan whose expanded media items exceed the total pixel budget", () => {
    const found = errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero-{{i}}.png", count: 8, image: { width: 4096, height: 4096 } },
    ]});
    expect(found.some((d) => d.message.includes("pixel budget"))).toBe(true);
  });

  // 7 items × 4096×4096 = 117 440 512 ≤ 128 000 000
  test("accepts a plan whose total pixel count is at or below the budget", () => {
    const found = errors({ planId: "p", items: [
      { key: "img", type: "ImageFile", name: "hero-{{i}}.png", count: 7, image: { width: 4096, height: 4096 } },
    ]});
    expect(found.some((d) => d.message.includes("pixel budget"))).toBe(false);
  });
});
