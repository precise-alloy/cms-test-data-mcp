import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseXml, writeXml } from "../src/xml/parse";
import { childElements, firstChild, rawText } from "../src/xml/query";
import { buildPackageIr } from "../src/plan/build";
import type { SchemaIndex } from "../src/schema/types";
import type { XElement } from "../src/xml/types";

const container = parseXml(
  readFileSync("tests/fixtures/list-block-container.xml", "utf8")
).root;

/** The container element order a real CMS writes for a populated list-kind block. */
const CONTAINER_TAIL = ["Type", "Name", "BlockProperties", "ListProperties", "CustomData"];

describe("the real CMS shape for a populated list-kind block", () => {
  test("has no BlockTypeReference on the container and entries inside ListProperties", () => {
    const names = childElements(container).map((c) => c.name);

    expect(names).not.toContain("BlockTypeReference");
    expect(names.slice(-CONTAINER_TAIL.length)).toEqual(CONTAINER_TAIL);
    expect(rawText(firstChild(container, "IsNull")!)).toBe("false");
    expect(childElements(firstChild(container, "BlockProperties")!).length).toBe(0);

    const entries = childElements(firstChild(container, "ListProperties")!);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(rawText(firstChild(entry, "Name")!)).toBe("Features");
      expect(firstChild(entry, "BlockTypeReference")).toBeDefined();
      expect(childElements(firstChild(entry, "BlockProperties")!).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip: our generator must produce the same structural facts.
// ---------------------------------------------------------------------------

const blockType = {
  guid: "7dd6684c-b7a7-4b57-abec-d192136075a0",
  name: "FeaturesBlockItem",
  modelTypeString:
    "Acme.SitePlatform.Web.Features.Blocks.FeaturesSectionBlock.FeaturesBlockItem, Acme.SitePlatform.Web, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
};

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    FeaturesBlockItem: {
      id: 50, guid: "7dd6684c-b7a7-4b57-abec-d192136075a0",
      name: "FeaturesBlockItem", displayName: "Features Block Item",
      base: "Block", kind: "block",
      properties: [
        { id: 532, name: "Heading", tabId: 0, dataType: "LongString",
          required: true, languageSpecific: true, editCaption: "Heading",
          valueKind: "text", createsDependency: false },
        { id: 533, name: "Text", tabId: 0, dataType: "LongString",
          required: false, languageSpecific: true, editCaption: "Text",
          valueKind: "text", createsDependency: false },
      ],
    },
    FeaturesPage: {
      id: 10, guid: "page-guid",
      name: "FeaturesPage", displayName: "Features Page",
      base: "Page", kind: "page",
      properties: [
        { id: 529, name: "Features", tabId: 0, dataType: "Block",
          required: false, languageSpecific: true, editCaption: "Features",
          valueKind: "block", createsDependency: false,
          blockType, blockKind: "List" },
      ],
    },
  },
};

const serialize = (el: XElement) =>
  writeXml({ bom: false, declaration: null, prologWhitespace: "", root: el });

function featuresProperty(items: unknown[]): XElement {
  const ir = buildPackageIr(
    {
      planId: "fixture-roundtrip",
      items: [{
        key: "page",
        type: "FeaturesPage",
        name: "Page",
        properties: { Features: items },
      }],
    },
    schema,
    new Date("2026-01-01T00:00:00Z")
  ).ir;
  const doc = parseXml(serialize(ir.selected[0]!));
  const bag = firstChild(firstChild(doc.root, "RawContentData")!, "Property")!;
  return childElements(bag).find((p) => rawText(firstChild(p, "Name")!) === "Features")!;
}

describe("our generated list-kind block matches the reference shape", () => {
  test("has no BlockTypeReference on the container and entries inside ListProperties", () => {
    const el = featuresProperty([
      { Heading: "sample", Text: "sample" },
      { Heading: "sample", Text: "sample" },
    ]);
    const names = childElements(el).map((c) => c.name);

    expect(names).not.toContain("BlockTypeReference");
    expect(rawText(firstChild(el, "IsNull")!)).toBe("false");
    expect(childElements(firstChild(el, "BlockProperties")!).length).toBe(0);

    const entries = childElements(firstChild(el, "ListProperties")!);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(rawText(firstChild(entry, "Name")!)).toBe("Features");
      expect(firstChild(entry, "BlockTypeReference")).toBeDefined();
      expect(childElements(firstChild(entry, "BlockProperties")!).length).toBeGreaterThan(0);
    }
  });
});
