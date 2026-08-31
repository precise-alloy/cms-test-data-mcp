import { describe, expect, test } from "bun:test";
import { parseXml } from "../src/xml/parse";
import { allProperties, topLevelProperties } from "../src/ir/inspect";

const item = (inner: string) => parseXml(`<TransferContentData>${inner}</TransferContentData>`).root;

const raw = (name: string, nested = "") =>
  `<RawProperty><Name>${name}</Name><Type>LongString</Type><IsNull>false</IsNull>` +
  `<Value>${name}!</Value><CustomData />${nested}</RawProperty>`;

const namesOf = (inner: string) => allProperties(item(inner)).map((p) => p.name);

describe("walking the properties of a package item", () => {
  test("reaches a property nested in ListProperties, not only one in BlockProperties", () => {
    const names = namesOf(
      `<RawContentData><Property>` +
        raw("Area", `<ListProperties>${raw("Entry")}</ListProperties>`) +
        raw("Banner", `<BlockProperties>${raw("Heading")}</BlockProperties>`) +
        `</Property></RawContentData>`
    );
    expect(names.sort()).toEqual(["Area", "Banner", "Entry", "Heading"]);
  });

  test("ignores the nil placeholders that stand in for empty list slots", () => {
    const names = namesOf(
      `<RawContentData><Property>` +
        raw(
          "Area",
          `<ListProperties><RawProperty xsi:nil="true" /><RawProperty xsi:nil="true" /></ListProperties>`
        ) +
        `</Property></RawContentData>`
    );
    expect(names).toEqual(["Area"]);
  });

  // Without the cap this input recurses 30 deep; a malformed package could go further.
  test("stops descending once nesting passes the depth cap", () => {
    let inner = raw("Leaf");
    for (let level = 30; level > 0; level--) {
      inner = raw(`Level${level}`, `<BlockProperties>${inner}</BlockProperties>`);
    }
    const names = namesOf(`<RawContentData><Property>${inner}</Property></RawContentData>`);
    expect(names).toHaveLength(11);
    expect(names[0]).toBe("Level1");
    expect(names.at(-1)).toBe("Level11");
    expect(names).not.toContain("Leaf");
  });

  test("reads properties written without the Property wrapper rather than reporting none", () => {
    const wrapped = item(`<RawContentData><Property>${raw("Title")}</Property></RawContentData>`);
    const bare = item(`<RawContentData>${raw("Title")}</RawContentData>`);
    expect(topLevelProperties(wrapped).map((p) => p.name)).toEqual(["Title"]);
    expect(topLevelProperties(bare).map((p) => p.name)).toEqual(["Title"]);
  });

  test("still collects each language branch under RawLanguageData", () => {
    const names = namesOf(
      `<RawContentData><Property>${raw("PageName")}</Property></RawContentData>` +
        `<RawLanguageData><RawContent><Property>${raw("Heading")}</Property></RawContent></RawLanguageData>`
    );
    expect(names.sort()).toEqual(["Heading", "PageName"]);
  });
});
