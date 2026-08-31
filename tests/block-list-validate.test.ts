import { describe, expect, test } from "bun:test";
import { validatePlan } from "../src/plan/validate";
import type { SchemaIndex } from "../src/schema/types";

const blockType = { guid: "bt", name: "ItemBlock", modelTypeString: "Acme.ItemBlock, Acme" };

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    ItemBlock: {
      id: 30, guid: "bt", name: "ItemBlock", displayName: "Item",
      base: "Block", kind: "block",
      properties: [
        { id: 601, name: "Heading", tabId: 0, dataType: "LongString",
          required: true, languageSpecific: false, editCaption: "Heading",
          valueKind: "text", createsDependency: false },
        { id: 602, name: "Target", tabId: 0, dataType: "ContentReference",
          required: false, languageSpecific: false, editCaption: "Target",
          valueKind: "contentRef", createsDependency: true },
      ],
    },
    HomePage: {
      id: 10, guid: "pg", name: "HomePage", displayName: "Home",
      base: "Page", kind: "page",
      properties: [
        { id: 529, name: "Many", tabId: 0, dataType: "Block",
          required: false, languageSpecific: false, editCaption: "Many",
          valueKind: "block", createsDependency: false, blockType, blockKind: "List" },
       { id: 530, name: "One", tabId: 0, dataType: "Block",
         required: false, languageSpecific: false, editCaption: "One",
         valueKind: "block", createsDependency: false, blockType, blockKind: "Value" },
      ],
    },
    RequiredListPage: {
     id: 11, guid: "pg2", name: "RequiredListPage", displayName: "Required list",
     base: "Page", kind: "page",
     properties: [
       { id: 531, name: "RequiredMany", tabId: 0, dataType: "Block",
         required: true, languageSpecific: false, editCaption: "RequiredMany",
         valueKind: "block", createsDependency: false, blockType, blockKind: "List" },
     ],
    },
  },
};

const check = (props: Record<string, unknown>) =>
  validatePlan(
    { planId: "v", items: [{ key: "home", type: "HomePage", name: "Home", properties: props }] },
    schema,
    new Date("2026-01-01T00:00:00Z")
  );

const errors = (props: Record<string, unknown>) =>
  check(props).filter((d) => d.level === "error").map((d) => d.message);

const requiredListErrors = (props: Record<string, unknown>) =>
  validatePlan(
    { planId: "v", items: [{ key: "home", type: "RequiredListPage", name: "Home", properties: props }] },
    schema,
    new Date("2026-01-01T00:00:00Z")
  ).filter((d) => d.level === "error").map((d) => d.message);

describe("a list-kind block value", () => {
  test("accepts an array of maps", () => {
    expect(errors({ Many: [{ Heading: "a" }, { Heading: "b" }] })).toEqual([]);
  });

  test("accepts an empty array", () => {
    expect(errors({ Many: [] })).toEqual([]);
  });

  test("rejects an empty array for a required list", () => {
    const e = requiredListErrors({ RequiredMany: [] });
    expect(e).toContain(`block property "RequiredMany" is required, so its list needs at least one entry — an empty list is written unset`);
    expect(errors({ Many: [] })).toEqual([]);
  });

  test("rejects a bare map, naming the expected shape", () => {
    const e = errors({ Many: { Heading: "a" } });
    expect(e.some((m) => m.includes("Many") && m.includes("array"))).toBe(true);
  });

  test("rejects an array for a Value-kind property", () => {
    const e = errors({ One: [{ Heading: "a" }] });
    expect(e.some((m) => m.includes("One"))).toBe(true);
  });

  test("reports a missing required field against the offending entry", () => {
    const e = errors({ Many: [{ Heading: "a" }, { Target: { ref: "home" } }] });
    expect(e.some((m) => m.includes("Heading"))).toBe(true);
  });

  test("reports an unknown field inside an entry", () => {
    const e = errors({ Many: [{ Heading: "a", Headnig: "typo" }] });
    expect(e.some((m) => m.includes("Headnig"))).toBe(true);
  });

  test("catches a dangling reference inside an entry", () => {
    const e = errors({ Many: [{ Heading: "a", Target: { ref: "nope" } }] });
    expect(e.some((m) => m.includes("nope"))).toBe(true);
  });

  test("accepts a reference inside an entry that resolves", () => {
    expect(errors({ Many: [{ Heading: "a", Target: { ref: "home" } }] })).toEqual([]);
  });
});
