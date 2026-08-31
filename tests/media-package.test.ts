import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildPackageIr } from "../src/plan/build";
import { writeIrToFile } from "../src/pkg/assemble";
import { readPackage } from "../src/pkg/read";
import type { PlanItem } from "../src/plan/types";
import type { SchemaIndex } from "../src/schema/types";

const outDir = join(process.cwd(), ".test-output");

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    ImageFile: {
      id: 20, guid: "img-guid", name: "ImageFile", displayName: "Image",
      base: "Image", kind: "media", properties: [],
    },
  },
};

function write(name: string, items: PlanItem[]) {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, name);
  const { ir, blobs } = buildPackageIr({ planId: "p", items }, schema, new Date("2026-01-01T00:00:00Z"));
  writeIrToFile(ir, ["11111111-1111-1111-1111-111111111111"], blobs, path);
  return { path, blobs, parts: readPackage(path) };
}

const withImage: PlanItem[] = [
  { key: "img", type: "ImageFile", name: "hero.png", image: { width: 320, height: 240 } },
];

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("a package containing media", () => {
  test("stores the blob under the doubled-slash entry name the importer builds", () => {
    const { blobs, parts } = write("media.episerverdata", withImage);
    const expected = blobs[0]!.entryName.replace(/^\//, "");
    expect([...parts.keys()]).toContain(expected);
    expect(parts.get(expected)!.equals(blobs[0]!.bytes)).toBe(true);
  });

  test("describes every blob in epiMedia.xml", () => {
    const { blobs, parts } = write("media.episerverdata", withImage);
    const xml = parts.get("epiMedia.xml")!.toString("utf8");
    const blob = blobs[0]!;
    expect(xml).toContain("<BinaryStorableTransferObject");
    expect(xml).toContain(`<Url>${blob.url}</Url>`);
    expect(xml).toContain(`<PermanentLinkVirtualPath>${blob.permanentLinkVirtualPath}</PermanentLinkVirtualPath>`);
    expect(xml).toContain(`<ProviderName>${blob.providerName}</ProviderName>`);
    expect(xml).toContain(`<ProviderRelativePath>${blob.providerRelativePath}</ProviderRelativePath>`);
  });

  test("declares a content type for png, which the package now contains", () => {
    const { parts } = write("media.episerverdata", withImage);
    const xml = parts.get("[Content_Types].xml")!.toString("utf8");
    expect(xml).toContain('<Default Extension="png" ContentType="image/png" />');
    expect(xml).toContain('<Default Extension="xml" ContentType="text/xml" />');
  });

  test("declares nothing it does not carry, so the manifest never lies", () => {
    const { parts } = write("no-media.episerverdata", []);
    const xml = parts.get("[Content_Types].xml")!.toString("utf8");
    expect(xml).toContain('<Default Extension="xml"');
    expect(xml).not.toContain('Extension="png"');
    expect(xml).not.toContain('Extension="jpg"');
  });

  test("keeps epiMedia.xml self-closing when the plan has no media", () => {
    const { parts } = write("no-media.episerverdata", []);
    expect(parts.get("epiMedia.xml")!.toString("utf8")).toContain("<exportFiles ");
    expect(parts.get("epiMedia.xml")!.toString("utf8")).not.toContain("BinaryStorableTransferObject");
  });
});
