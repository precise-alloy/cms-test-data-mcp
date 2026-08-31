import { describe, expect, test } from "bun:test";
import { skeletonOmissionReason } from "../src/plan/validate";
import { toolManifest } from "../src/mcp/server";
import type { PropertyInfo } from "../src/schema/types";

const blockProp: PropertyInfo = {
  id: 500, name: "Banner", tabId: 0, dataType: "Block",
  required: false, languageSpecific: false, editCaption: "Banner",
  valueKind: "block", createsDependency: false,
  blockType: { guid: "g", name: "BannerBlock", modelTypeString: "Acme.BannerBlock, Acme" },
};

describe("inline block discoverability", () => {
  test("a block property is no longer omitted from the skeleton", () => {
    expect(skeletonOmissionReason(blockProp)).toBeUndefined();
  });

  test("the manifest tells an agent the shape a block value takes", () => {
    const validate = toolManifest.find((t) => t.name === "validate_plan")!;
    const described = JSON.stringify(validate.inputSchema);
    expect(described).toContain("block");
  });

  test("the manifest stays within its budget", () => {
    expect(JSON.stringify(toolManifest).length).toBeLessThan(12000);
  });
});
