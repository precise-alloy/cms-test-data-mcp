import { describe, expect, test } from "bun:test";
import { buildPackageIr } from "../src/plan/build";
import { writeXml } from "../src/xml/parse";
import type { XElement } from "../src/xml/types";
import type { PlanItem } from "../src/plan/types";
import type { SchemaIndex } from "../src/schema/types";

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    ImageFile: {
      id: 20, guid: "img-guid", name: "ImageFile", displayName: "Image",
      base: "Image", kind: "media", properties: [],
    },
    ArticlePage: {
      id: 10, guid: "page-guid", name: "ArticlePage", displayName: "Article",
      base: "Page", kind: "page",
      properties: [{
        id: 500, name: "Hero", tabId: 0, dataType: "ContentReference",
        required: false, languageSpecific: false, editCaption: "Hero",
        valueKind: "contentRef", createsDependency: true,
      }],
    },
  },
};

const serialize = (el: XElement) =>
  writeXml({ bom: false, declaration: null, prologWhitespace: "", root: el });

const build = (items: PlanItem[]) =>
  buildPackageIr({ planId: "p", items }, schema, new Date("2026-01-01T00:00:00Z"));

const mediaXml = (result: ReturnType<typeof buildPackageIr>) => {
  const found = [...result.ir.selected, ...result.ir.closure]
    .map(serialize)
    .find((xml) => xml.includes("PropertyBlob"));
  if (!found) throw new Error("no media item was built");
  return found;
};

const image: PlanItem = { key: "img", type: "ImageFile", name: "hero.png" };

describe("building a media item", () => {
  test("writes a BinaryData property pointing at the generated blob", () => {
    const result = build([image]);
    expect(result.blobs).toHaveLength(1);
    const xml = mediaXml(result);
    expect(xml).toContain("<Name>BinaryData</Name>");
    expect(xml).toContain("EPiServer.SpecializedProperties.PropertyBlob");
    expect(xml).toContain(result.blobs[0]!.url);
  });

  test("leaves Thumbnail null so the CMS generates the 48x48 itself", () => {
    const xml = mediaXml(build([image]));
    const thumbnail =
      /<RawProperty>(?:(?!<\/RawProperty>)[\s\S])*?<Name>Thumbnail<\/Name>[\s\S]*?<\/RawProperty>/.exec(xml)![0];
    expect(thumbnail).toContain("<IsNull>true</IsNull>");
    expect(thumbnail).toContain("<Value />");
    expect(thumbnail).toContain("EPiServer.SpecializedProperties.PropertyBlob");
  });

  test("omits the system properties Optimizely never puts on media", () => {
    const xml = mediaXml(build([image]));
    for (const absent of [
      "PageMasterLanguageBranch",
      "PageLanguageBranch",
      "PageContentAssetsID",
      "PageVisibleInMenu",
    ]) {
      expect(xml).not.toContain(`<Name>${absent}</Name>`);
    }
  });

  test("marks the audit fields language-specific, which pages do not", () => {
    const xml = mediaXml(build([image]));
    for (const name of ["PageCreated", "PageCreatedBy", "PageChangedBy", "PageChangedOnPublish"]) {
      const property =
        new RegExp(`<RawProperty>(?:(?!</RawProperty>)[\\s\\S])*?<Name>${name}</Name>[\\s\\S]*?</RawProperty>`).exec(xml)![0];
      expect(property).toContain("<IsLanguageSpecific>true</IsLanguageSpecific>");
    }
  });

  test("has no language data block, matching every media item in real exports", () => {
    expect(mediaXml(build([image]))).not.toContain("<RawLanguageData>");
  });

  test("anchors media to the global assets root", () => {
    expect(mediaXml(build([image]))).toContain(
      "<Name>EPi:SystemReference</Name><Value>EPi:GlobalResourcesRoot</Value>"
    );
  });

  test("gives the url segment a .png extension whatever the name says", () => {
    const xml = mediaXml(build([{ key: "img", type: "ImageFile", name: "Hero Banner.jpg" }]));
    expect(xml).toContain("<Name>PageURLSegment</Name><Value>hero-banner.png</Value>");
  });

  test("places media in the dependency closure, never in the selected block", () => {
    const result = build([image]);
    expect(result.ir.selected).toHaveLength(0);
    expect(result.ir.closure.length).toBeGreaterThan(0);
  });

  test("uses the requested dimensions, and the default when none are given", () => {
    const sized = build([{ ...image, image: { width: 800, height: 600 } }]);
    expect(sized.blobs[0]!.bytes.readUInt32BE(16)).toBe(800);
    expect(sized.blobs[0]!.bytes.readUInt32BE(20)).toBe(600);

    const defaulted = build([image]);
    expect(defaulted.blobs[0]!.bytes.readUInt32BE(16)).toBe(1280);
    expect(defaulted.blobs[0]!.bytes.readUInt32BE(20)).toBe(720);
  });

  test("squares the image when only one dimension is given", () => {
    const result = build([{ ...image, image: { width: 400 } }]);
    expect(result.blobs[0]!.bytes.readUInt32BE(16)).toBe(400);
    expect(result.blobs[0]!.bytes.readUInt32BE(20)).toBe(400);
  });

  test("keeps blob identity stable across runs so re-import overwrites in place", () => {
    const a = build([image]);
    const b = build([image]);
    expect(a.blobs[0]!.entryName).toBe(b.blobs[0]!.entryName);
    expect(a.blobs[0]!.bytes.equals(b.blobs[0]!.bytes)).toBe(true);
  });

  test("keeps one media item as one entity however many pages reference it", () => {
    const result = build([
      image,
      { key: "p1", type: "ArticlePage", name: "One", properties: { Hero: { ref: "img" } } },
      { key: "p2", type: "ArticlePage", name: "Two", properties: { Hero: { ref: "img" } } },
      { key: "p3", type: "ArticlePage", name: "Three", properties: { Hero: { ref: "img" } } },
    ]);
    expect(result.blobs).toHaveLength(1);
    const all = [...result.ir.selected, ...result.ir.closure].map(serialize);
    expect(all.filter((xml) => xml.includes("PropertyBlob"))).toHaveLength(1);
  });

  test("gives each copy its own blob when count asks for several", () => {
    const result = build([{ key: "img", type: "ImageFile", name: "hero-{{i}}.png", count: 3 }]);
    expect(result.blobs).toHaveLength(3);
    expect(new Set(result.blobs.map((b) => b.entryName)).size).toBe(3);
  });

  test("creates no block folder for a plan that holds only media", () => {
    const all = [...build([image]).ir.closure].map(serialize);
    expect(all.some((xml) => xml.includes("SysContentFolder"))).toBe(false);
  });
});

describe("buildPackageIr defensive guards", () => {
  const videoSchema: SchemaIndex = {
    culture: "en-US",
    version: "4",
    types: {
      VideoMedia: {
        id: 30, guid: "vid-guid", name: "VideoMedia", displayName: "Video",
        base: "Video", kind: "media", properties: [],
      },
      MpegOnlyMedia: {
        id: 31, guid: "mpg-guid", name: "MpegOnlyMedia", displayName: "MPEG Only",
        base: "Media", kind: "media", properties: [],
        supportedMediaExtensions: "<string>mp4</string>",
      },
      ImageFile: {
        id: 20, guid: "img-guid", name: "ImageFile", displayName: "Image",
        base: "Image", kind: "media", properties: [],
      },
    },
  };

  const buildWith = (items: PlanItem[], s = videoSchema) =>
    buildPackageIr({ planId: "p", items }, s, new Date("2026-01-01T00:00:00Z"));

  test("throws when a Video-based type reaches the blob loop", () => {
    expect(() => buildWith([{ key: "vid", type: "VideoMedia", name: "clip.mp4" }])).toThrow(
      /cannot hold a placeholder PNG/
    );
  });

  test("throws when a type with no-png declared extensions reaches the blob loop", () => {
    expect(() => buildWith([{ key: "m", type: "MpegOnlyMedia", name: "clip.mp4" }])).toThrow(
      /cannot hold a placeholder PNG/
    );
  });

  test("throws when total pixels exceed the budget in buildPackageIr directly", () => {
    // 8 × 4096×4096 = 134 217 728 > 128 000 000
    const items: PlanItem[] = Array.from({ length: 8 }, (_, i) => ({
      key: `img-${i}`,
      type: "ImageFile",
      name: `hero-${i}.png`,
      image: { width: 4096, height: 4096 },
    }));
    expect(() => buildWith(items)).toThrow(/pixel budget exceeded/);
  });

  test("throws when declared item count exceeds MAX_PLAN_ITEMS before any expansion", () => {
    // 5 × 1000 + 1 = 5001 > 5000
    expect(() => buildWith([
      { key: "img1", type: "ImageFile", name: "hero-1-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img2", type: "ImageFile", name: "hero-2-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img3", type: "ImageFile", name: "hero-3-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img4", type: "ImageFile", name: "hero-4-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img5", type: "ImageFile", name: "hero-5-{{i}}.png", count: 1000, image: { width: 1, height: 1 } },
      { key: "img6", type: "ImageFile", name: "hero-6-{{i}}.png", count: 1, image: { width: 1, height: 1 } },
    ])).toThrow(/plan expands to 5,001 items.*limit is 5,000/);
  });
});
