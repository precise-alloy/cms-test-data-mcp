import { describe, expect, test } from "bun:test";
import { validatePlan, skeletonOmissionReason } from "../src/plan/validate";
import { buildPackageIr } from "../src/plan/build";
import type { SchemaIndex } from "../src/schema/types";

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    BannerBlock: {
      id: 30, guid: "block-guid", name: "BannerBlock", displayName: "Banner",
      base: "Block", kind: "block",
      properties: [
        { id: 601, name: "Message", tabId: 0, dataType: "LongString",
          required: true, languageSpecific: false, editCaption: "Message",
          valueKind: "text", createsDependency: false },
        { id: 602, name: "Dismissible", tabId: 0, dataType: "Boolean",
          required: false, languageSpecific: false, editCaption: "Dismissible",
          valueKind: "bool", createsDependency: false },
        { id: 603, name: "Extras", tabId: 0, dataType: "Json",
          required: false, languageSpecific: false, editCaption: "Extras",
          valueKind: "unproven", createsDependency: false },
        { id: 604, name: "Target", tabId: 0, dataType: "ContentReference",
          required: false, languageSpecific: false, editCaption: "Target",
          valueKind: "contentRef", createsDependency: true },
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
            guid: "block-guid", name: "BannerBlock",
            modelTypeString: "Acme.Models.Blocks.BannerBlock, Acme.Models",
          } },
      ],
    },
  },
};

const check = (banner: unknown) =>
  validatePlan(
    { planId: "v", items: [{ key: "home", type: "HomePage", name: "Home", properties: { Banner: banner } }] },
    schema,
    new Date("2026-01-01T00:00:00Z")
  );

const checkWithExtra = (banner: unknown, extraItems: object[]) =>
  validatePlan(
    {
      planId: "v",
      items: [
        { key: "home", type: "HomePage", name: "Home", properties: { Banner: banner } },
        ...extraItems as Parameters<typeof validatePlan>[0]["items"],
      ],
    },
    schema,
    new Date("2026-01-01T00:00:00Z")
  );

describe("a nested block value", () => {
  test("accepts a partial map when no required child is missing", () => {
    const d = check({ Message: "Hi", Dismissible: true });
    expect(d.filter((x) => x.level === "error")).toEqual([]);
  });

  test("rejects a child that does not exist on the block type", () => {
    const d = check({ Message: "Hi", Mesage: "typo" });
    expect(d.some((x) => x.level === "error" && x.message.includes("Mesage"))).toBe(true);
  });

  test("rejects a child whose value is the wrong shape", () => {
    const d = check({ Message: "Hi", Dismissible: "yes please" });
    expect(d.some((x) => x.level === "error" && x.message.includes("Dismissible"))).toBe(true);
  });

  test("rejects a missing required child", () => {
    const d = check({ Dismissible: true });
    expect(d.some((x) => x.level === "error" && x.message.includes("Message"))).toBe(true);
  });

  test("warns rather than errors on an unproven child", () => {
    const d = check({ Message: "Hi", Extras: { anything: 1 } });
    expect(d.filter((x) => x.level === "error")).toEqual([]);
    expect(d.some((x) => x.level === "warning" && x.message.includes("Extras"))).toBe(true);
  });

  test("rejects a block value that is not an object", () => {
    const d = check("just a string");
    expect(d.some((x) => x.level === "error" && x.message.includes("Banner"))).toBe(true);
  });
});

describe("nested contentRef key existence", () => {
  test("rejects a nested contentRef pointing at a missing key (validate reports error, not silent)", () => {
    const d = check({ Message: "Hi", Target: { ref: "does-not-exist" } });
    expect(d.some((x) => x.level === "error" && x.message.includes("does-not-exist"))).toBe(true);
  });

  test("accepts a nested contentRef pointing at a key that exists", () => {
    const d = checkWithExtra(
      { Message: "Hi", Target: { ref: "other-page" } },
      [{ key: "other-page", type: "HomePage", name: "Other" }]
    );
    expect(d.filter((x) => x.level === "error")).toEqual([]);
  });
});

// ── absent-blockType graceful-degradation path ────────────────────────────────
// A block property whose <BlockType> element was absent in the export (hand-
// written or partial schema) must never throw; it must degrade gracefully by
// warning and leaving the value empty.  This is a deliberate ruling: 0 of 738
// real block properties lack blockType, but the branch exists for robustness.

const noBlockTypeSchema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    PartialPage: {
      id: 20, guid: "partial-guid", name: "PartialPage", displayName: "Partial",
      base: "Page", kind: "page",
      properties: [
        { id: 800, name: "Widget", tabId: 0, dataType: "Block",
          required: false, languageSpecific: false, editCaption: "Widget",
          valueKind: "block", createsDependency: false,
          // blockType intentionally absent — simulates a partial/hand-written schema
        },
      ],
    },
  },
};

const widgetProp = noBlockTypeSchema.types["PartialPage"]!.properties[0]!;

describe("block property without blockType (graceful-degradation ruling)", () => {
  test("skeletonOmissionReason returns a reason, so the property is omitted from the skeleton", () => {
    const reason = skeletonOmissionReason(widgetProp);
    expect(reason).toBeDefined();
    expect(typeof reason).toBe("string");
  });

  test("validatePlan emits a warning (not an error) when a value is supplied", () => {
    const diags = validatePlan(
      { planId: "x", items: [{ key: "p", type: "PartialPage", name: "P", properties: { Widget: { foo: "bar" } } }] },
      noBlockTypeSchema,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(diags.filter((d) => d.level === "error")).toEqual([]);
    expect(diags.some((d) => d.level === "warning" && d.message.includes("Widget"))).toBe(true);
  });

  test("buildPackageIr does not throw and emits a warning when a value is supplied", () => {
    let result: ReturnType<typeof buildPackageIr>;
    expect(() => {
      result = buildPackageIr(
        { planId: "x", items: [{ key: "p", type: "PartialPage", name: "P", properties: { Widget: { foo: "bar" } } }] },
        noBlockTypeSchema,
        new Date("2026-01-01T00:00:00Z")
      );
    }).not.toThrow();
    expect(result!.warnings.some((w) => w.level === "warning" && w.message.includes("Widget"))).toBe(true);
  });
});
