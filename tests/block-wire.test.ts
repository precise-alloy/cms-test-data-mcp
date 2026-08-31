import { describe, expect, test } from "bun:test";
import { rawProperty } from "../src/plan/build";
import { writeXml } from "../src/xml/parse";
import { parseXml } from "../src/xml/parse";
import { childElements, element, firstChild } from "../src/xml/query";
import type { XElement } from "../src/xml/types";
import { allProperties } from "../src/ir/inspect";

const serialize = (el: XElement) =>
  writeXml({ bom: false, declaration: null, prologWhitespace: "", root: el });

const blockTypeRef = {
  guid: "553aa286-eb9a-48a4-a130-e1ce39663820",
  name: "BannerBlock",
  modelTypeString: "Acme.Models.Blocks.BannerBlock, Acme.Models, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
};

const child = (name: string, value?: string) =>
  rawProperty({
    definitionId: 601, ownerTab: 0, isPropertyData: true,
    isNull: value === undefined, type: "LongString", name, value,
  });

const populated = () =>
  rawProperty({
    definitionId: 500, ownerTab: 0, isPropertyData: true, isNull: false,
    type: "Block", name: "Banner",
    typeName: "EPiServer.SpecializedProperties.PropertyBlock`1[Acme.Models.Blocks.BannerBlock]",
    assemblyName: "EPiServer",
    blockTypeRef,
    blockChildren: [child("Message", "Scheduled maintenance"), child("Dismissible")],
  });

/**
 * Serialize only the outer RawProperty's portion before BlockProperties.
 * The nested unset `Dismissible` child legitimately emits its own `<Value />`,
 * so a whole-string assertion on `<Value />` absence would always fail.
 */
const outerXml = (el: XElement) => {
  const xml = serialize(el);
  const blockStart = xml.indexOf("<BlockProperties>");
  return blockStart === -1 ? xml : xml.slice(0, blockStart);
};

describe("a populated inline block on the wire", () => {
  test("is not null and carries no Value element", () => {
    const outer = outerXml(populated());
    expect(outer).toContain("<IsNull>false</IsNull>");
    expect(outer).not.toContain("<Value />");
    expect(outer).not.toContain("<Value/>");
    expect(outer).not.toContain("<Value>");
  });

  test("carries a BlockTypeReference copied from the schema", () => {
    const xml = serialize(populated());
    expect(xml).toContain("<BlockTypeReference>");
    expect(xml).toContain("<GUID>553aa286-eb9a-48a4-a130-e1ce39663820</GUID>");
    expect(xml).toContain("<Name>BannerBlock</Name>");
    expect(xml).toContain("Acme.Models.Blocks.BannerBlock, Acme.Models");
  });

  test("writes every child it was given, marking the valueless one null", () => {
    const xml = serialize(populated());
    const open = xml.indexOf("<BlockProperties>");
    const inner = xml.slice(open, xml.indexOf("</BlockProperties>", open));
    expect((inner.match(/<RawProperty>/g) ?? []).length).toBe(2);
    expect(inner).toContain("<Name>Message</Name>");
    expect(inner).toContain("<Name>Dismissible</Name>");
    expect(inner).toContain("Scheduled maintenance");
  });

  test("an unset block still writes an empty Value and no BlockTypeReference", () => {
    const xml = serialize(
      rawProperty({ definitionId: 500, ownerTab: 0, isPropertyData: true, isNull: true, type: "Block", name: "Banner" })
    );
    expect(xml).toContain("<IsNull>true</IsNull>");
    expect(xml).not.toContain("<BlockTypeReference>");
    expect(xml).toMatch(/<Value ?\/>/);
  });

  test("round-trips: the reader classifies it as a populated block", () => {
    const doc = parseXml(serialize(populated()));
    // topLevelProperties walks RawContentData > Property > RawProperty, so wrap
    // the bare parsed root in the minimal structure it expects.
    const wrapper = element("RawContent", [
      element("RawContentData", [
        element("Property", [doc.root]),
      ]),
    ]);
    const props = allProperties(wrapper);
    const banner = props.find((p) => p.name === "Banner")!;
    expect(banner.shape).toBe(3);
    expect(banner.isNull).toBe(false);
    expect(props.some((p) => p.name === "Message" && p.value?.includes("Scheduled"))).toBe(true);
  });
});

import { buildPackageIr } from "../src/plan/build";
import type { SchemaIndex } from "../src/schema/types";

const e2eSchema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    BannerBlock: {
      id: 30, guid: "block-guid", name: "BannerBlock", displayName: "Banner",
      base: "Block", kind: "block",
      properties: [
        { id: 601, name: "Message", tabId: 0, dataType: "LongString",
          required: false, languageSpecific: false, editCaption: "Message",
          valueKind: "text", createsDependency: false },
        { id: 602, name: "Dismissible", tabId: 0, dataType: "Boolean",
          required: false, languageSpecific: false, editCaption: "Dismissible",
          valueKind: "bool", createsDependency: false },
      ],
    },
    HomePage: {
      id: 10, guid: "page-guid", name: "HomePage", displayName: "Home",
      base: "Page", kind: "page",
      properties: [
        { id: 500, name: "Banner", tabId: 0, dataType: "Block",
          required: false, languageSpecific: false, editCaption: "Banner",
          valueKind: "block", createsDependency: false,
          blockType: {
            guid: "553aa286-eb9a-48a4-a130-e1ce39663820",
            name: "BannerBlock",
            modelTypeString: "Acme.Models.Blocks.BannerBlock, Acme.Models, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
          } },
      ],
    },
  },
};

describe("an inline block supplied by a plan", () => {
  test("reaches the wire as a populated block with all declared children", () => {
    const { ir } = buildPackageIr(
      { planId: "e2e", items: [
        { key: "home", type: "HomePage", name: "Home",
          properties: { Banner: { Message: "Scheduled maintenance" } } },
      ] },
      e2eSchema,
      new Date("2026-01-01T00:00:00Z")
    );
    const doc = parseXml(serialize(ir.selected[0]!));
    const props = allProperties(doc.root);
    const banner = props.find((p) => p.name === "Banner")!;
    expect(banner.shape).toBe(3);
    expect(banner.isNull).toBe(false);
    expect(props.some((p) => p.name === "Message" && p.value?.includes("Scheduled"))).toBe(true);
    // Dismissible was not supplied, so it is written but null — as the CMS writes it.
    const dismissible = props.find((p) => p.name === "Dismissible")!;
    expect(dismissible.isNull).toBe(true);
  });

  test("names the block type in TypeName", () => {
    const { ir } = buildPackageIr(
      { planId: "e2e2", items: [
        { key: "home", type: "HomePage", name: "Home", properties: { Banner: { Message: "x" } } },
      ] },
      e2eSchema,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(serialize(ir.selected[0]!)).toContain(
      "EPiServer.SpecializedProperties.PropertyBlock`1[Acme.Models.Blocks.BannerBlock]"
    );
  });
});
