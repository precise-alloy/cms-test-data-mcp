import { describe, expect, test } from "bun:test";
import { validatePlan } from "../src/plan/validate";
import type { ContentPlan } from "../src/plan/types";
import type { SchemaIndex } from "../src/schema/types";

const schema: SchemaIndex = {
  culture: "en",
  version: "4",
  types: {
    TargetPage: {
      id: 1,
      guid: "target-guid",
      name: "TargetPage",
      displayName: "TargetPage",
      base: "Page",
      kind: "page",
      properties: [],
    },
    LinkBlock: {
      id: 2,
      guid: "link-block-guid",
      name: "LinkBlock",
      displayName: "LinkBlock",
      base: "Block",
      kind: "block",
      properties: [{
        id: 201,
        name: "Target",
        tabId: 0,
        dataType: "ContentReference",
        required: false,
        languageSpecific: false,
        editCaption: "Target",
        valueKind: "contentRef",
        createsDependency: true,
      }],
    },
    RefPage: {
      id: 3,
      guid: "ref-page-guid",
      name: "RefPage",
      displayName: "RefPage",
      base: "Page",
      kind: "page",
      properties: [{
        id: 301,
        name: "Featured",
        tabId: 0,
        dataType: "ContentReference",
        required: false,
        languageSpecific: false,
        editCaption: "Featured",
        valueKind: "contentRef",
        createsDependency: true,
      }, {
        id: 302,
        name: "Inline",
        tabId: 0,
        dataType: "Block",
        required: false,
        languageSpecific: false,
        editCaption: "Inline",
        valueKind: "block",
        createsDependency: false,
        blockType: { guid: "link-block-guid", name: "LinkBlock", modelTypeString: "Tests.LinkBlock, Tests" },
        blockKind: "Value",
      }],
    },
  },
};

const plan = (properties: Record<string, unknown>, withTarget = false): ContentPlan => ({
  planId: "string-ref",
  items: [
    {
      key: "page",
      type: "RefPage",
      name: "Page",
      properties,
    },
    ...(withTarget ? [{
      key: "target",
      type: "TargetPage",
      name: "Target",
    }] : []),
  ],
});

describe("string references in validatePlan", () => {
  test("reports dangling top-level string references with the object-ref message", () => {
    const errors = validatePlan(plan({ Featured: "nope" }), schema).filter((d) => d.level === "error");

    expect(errors).toContainEqual({
      level: "error",
      path: "items[0](page).properties.Featured",
      message: 'key "nope" not found',
    });
  });

  test("reports dangling string references inside block values with the object-ref message", () => {
    const errors = validatePlan(plan({ Inline: { Target: "nope" } }), schema).filter((d) => d.level === "error");

    expect(errors).toContainEqual({
      level: "error",
      path: "items[0](page).properties.Inline.Target",
      message: 'key "nope" not found',
    });
  });

  test("accepts valid string references at the top level and inside blocks", () => {
    const errors = validatePlan(plan({ Featured: "target", Inline: { Target: "target" } }, true), schema)
      .filter((d) => d.level === "error");

    expect(errors).toEqual([]);
  });
});
