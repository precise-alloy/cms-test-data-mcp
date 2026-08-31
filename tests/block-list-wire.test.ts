import { describe, expect, test } from "bun:test";
import { buildPackageIr } from "../src/plan/build";
import { writeXml, parseXml } from "../src/xml/parse";
import { childElements, firstChild, rawText } from "../src/xml/query";
import type { XElement } from "../src/xml/types";
import type { SchemaIndex } from "../src/schema/types";

const serialize = (el: XElement) =>
  writeXml({ bom: false, declaration: null, prologWhitespace: "", root: el });

const blockType = {
  guid: "7dd6684c-b7a7-4b57-abec-d192136075a0",
  name: "ItemBlock",
  modelTypeString: "Acme.Models.ItemBlock, Acme.Models, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
};

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    ItemBlock: {
      id: 30, guid: "bt", name: "ItemBlock", displayName: "Item",
      base: "Block", kind: "block",
      properties: [
        { id: 601, name: "Heading", tabId: 0, dataType: "LongString",
          required: false, languageSpecific: false, editCaption: "Heading",
          valueKind: "text", createsDependency: false },
      ],
    },
    HomePage: {
      id: 10, guid: "pg", name: "HomePage", displayName: "Home",
      base: "Page", kind: "page",
      properties: [
        { id: 529, name: "Many", tabId: 0, dataType: "Block",
          required: false, languageSpecific: false, editCaption: "Many",
          valueKind: "block", createsDependency: false,
          blockType, blockKind: "List" },
      ],
    },
  },
};

const build = (many: unknown) =>
  buildPackageIr(
    { planId: "list", items: [{ key: "home", type: "HomePage", name: "Home", properties: { Many: many } }] },
    schema,
    new Date("2026-01-01T00:00:00Z")
  );

/** The `Many` RawProperty inside RawContentData, as an element. */
function manyProperty(ir: ReturnType<typeof build>["ir"]): XElement {
  const doc = parseXml(serialize(ir.selected[0]!));
  const bag = firstChild(firstChild(doc.root, "RawContentData")!, "Property")!;
  return childElements(bag).find((p) => rawText(firstChild(p, "Name")!) === "Many")!;
}

describe("a populated list-kind block on the wire", () => {
  test("the container carries no TypeName, no BlockTypeReference and no Value", () => {
    const el = manyProperty(build([{ Heading: "one" }, { Heading: "two" }]).ir);
    const names = childElements(el).map((c) => c.name);
    expect(names).not.toContain("TypeName");
    expect(names).not.toContain("AssemblyName");
    expect(names).not.toContain("BlockTypeReference");
    // Measured: all 14 populated list containers across 25 real exports omit Value.
    expect(names).not.toContain("Value");
    expect(rawText(firstChild(el, "IsNull")!)).toBe("false");
  });

  test("the container's BlockProperties is empty and the items are in ListProperties", () => {
    const el = manyProperty(build([{ Heading: "one" }, { Heading: "two" }]).ir);
    expect(childElements(firstChild(el, "BlockProperties")!).length).toBe(0);
    const entries = childElements(firstChild(el, "ListProperties")!);
    expect(entries.length).toBe(2);
  });

  test("each entry is a populated block reusing the container's name and definition id", () => {
    const el = manyProperty(build([{ Heading: "one" }, { Heading: "two" }]).ir);
    const entries = childElements(firstChild(el, "ListProperties")!);
    for (const entry of entries) {
      expect(rawText(firstChild(entry, "Name")!)).toBe("Many");
      expect(rawText(firstChild(entry, "PropertyDefinitionID")!)).toBe("529");
      expect(rawText(firstChild(entry, "IsModified")!)).toBe("true");
      expect(firstChild(entry, "BlockTypeReference")).toBeDefined();
      expect(childElements(firstChild(entry, "BlockProperties")!).length).toBe(1);
    }
    const headings = entries.map((e) =>
      rawText(firstChild(childElements(firstChild(e, "BlockProperties")!)[0]!, "Value")!)
    );
    expect(headings).toEqual(["one", "two"]);
  });

  test("an empty list is written as unset", () => {
    const el = manyProperty(build([]).ir);
    expect(rawText(firstChild(el, "IsNull")!)).toBe("true");
    expect(childElements(firstChild(el, "BlockProperties")!).length).toBe(0);
    expect(childElements(firstChild(el, "ListProperties")!).length).toBe(0);
    expect(childElements(el).map((c) => c.name)).not.toContain("BlockTypeReference");
  });
});
