import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createToolset } from "../src/mcp/tools";
import { buildPackageIr } from "../src/plan/build";
import { validatePlan } from "../src/plan/validate";
import {
  DEFAULT_IMAGE_HEIGHT,
  DEFAULT_IMAGE_WIDTH,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_PLAN_ITEMS,
} from "../src/media/png";
import type { ContentPlan } from "../src/plan/types";
import type { SchemaIndex } from "../src/schema/types";

const outDir = join(process.cwd(), ".test-output");
const usageGuidePointer = "Call usage_guide before writing your first plan for this schema.";
const mediaSchema: SchemaIndex = {
  culture: "en",
  version: "4",
  types: {
    ImageFile: {
      id: 1,
      guid: "image-type",
      name: "ImageFile",
      displayName: "Image File",
      base: "Image",
      kind: "media",
      properties: [],
    },
  },
};

function writePackage(path: string, epiDefinitionXml: string): void {
  mkdirSync(outDir, { recursive: true });
  const zip = new AdmZip();
  zip.addFile("epiDefinition.xml", Buffer.from(epiDefinitionXml, "utf8"));
  zip.writeZip(path);
}

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("the usage guide returned by the toolset", () => {
  test("renders current plan and image constants with their source formatting", async () => {
    const guide = await createToolset(process.cwd()).usageGuide();
    const dimensionLimit = String(MAX_IMAGE_DIMENSION);
    const defaultWidth = String(DEFAULT_IMAGE_WIDTH);
    const defaultHeight = String(DEFAULT_IMAGE_HEIGHT);

    expect(guide).toContain("beyond `5,000` items");
    expect(guide).toContain("total image pixels above `128,000,000`");
    expect(guide).toContain(`image dimension above \`${dimensionLimit}\` pixels`);
    expect(guide).toContain(`defaults to \`${defaultWidth}×${defaultHeight}\``);

    for (const placeholder of [
      "{{MAX_PLAN_ITEMS}}",
      "{{MAX_IMAGE_PIXELS}}",
      "{{MAX_IMAGE_DIMENSION}}",
      "{{DEFAULT_IMAGE_WIDTH}}",
      "{{DEFAULT_IMAGE_HEIGHT}}",
    ]) {
      expect(guide).not.toContain(placeholder);
    }

    expect(guide).toContain("{{date:");
  });

  test("passes the pinned diagnostic locale to every human limit formatter", async () => {
    const originalToLocaleString = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (this: number, locale?: string | string[], options?: Intl.NumberFormatOptions): string {
      if (locale === "en-US") return originalToLocaleString.call(this, locale, options);
      return `UNPINNED:${String(this)}`;
    };

    try {
      const guide = await createToolset(process.cwd()).usageGuide();
      expect(guide).toContain("beyond `5,000` items");
      expect(guide).toContain("total image pixels above `128,000,000`");
      expect(guide).not.toContain("UNPINNED");

      const tooManyItems: ContentPlan = {
        planId: "limits",
        items: Array.from({ length: 6 }, (_, i) => ({
          key: `item-${i}`,
          type: "ImageFile",
          name: `Item ${i}`,
          count: 1000,
        })),
      };
      const tooManyItemsValidationMessage = validatePlan(tooManyItems, mediaSchema)[0]?.message ?? "";
      expect(tooManyItemsValidationMessage).toContain("5,000");
      expect(tooManyItemsValidationMessage).not.toContain("UNPINNED");
      let tooManyItemsBuildMessage = "";
      try {
        buildPackageIr(tooManyItems, mediaSchema, new Date("2026-01-01T00:00:00Z"));
      } catch (error) {
        tooManyItemsBuildMessage = error instanceof Error ? error.message : String(error);
      }
      expect(tooManyItemsBuildMessage).toContain("5,000");
      expect(tooManyItemsBuildMessage).not.toContain("UNPINNED");

      const tooManyPixels: ContentPlan = {
        planId: "pixels",
        items: [{
          key: "image",
          type: "ImageFile",
          name: "Large image",
          count: 8,
          image: { width: 4096, height: 4096 },
        }],
      };
      const tooManyPixelsValidationMessage = validatePlan(tooManyPixels, mediaSchema)[0]?.message ?? "";
      expect(tooManyPixelsValidationMessage).toContain("128,000,000");
      expect(tooManyPixelsValidationMessage).not.toContain("UNPINNED");
      let tooManyPixelsBuildMessage = "";
      try {
        buildPackageIr(tooManyPixels, mediaSchema, new Date("2026-01-01T00:00:00Z"));
      } catch (error) {
        tooManyPixelsBuildMessage = error instanceof Error ? error.message : String(error);
      }
      expect(tooManyPixelsBuildMessage).toContain("128,000,000");
      expect(tooManyPixelsBuildMessage).not.toContain("UNPINNED");
    } finally {
      Number.prototype.toLocaleString = originalToLocaleString;
    }
  });

  test("describes cleanup, content identity, and one-dimensional image sizes precisely", async () => {
    const guide = await createToolset(process.cwd()).usageGuide();

    expect(guide).toContain("Blocks are collected in the `planId` folder, pages stay under the import destination, and media lands in global assets, so cleanup has to cover all three places.");
    expect(guide).toContain("Content GUIDs derive from `planId` and each item's `key`");
    expect(guide).toContain("Changing a key, including by changing which auto-generated key an item receives, creates a duplicate rather than an update.");
    expect(guide).toContain("A lone `width` or `height` is used for both axes, producing a square.");
  });

  test("omits ritus workflow anchors from the rendered output", async () => {
    const guide = await createToolset(process.cwd()).usageGuide();

    for (const anchor of [
      ".qa/",
      "<ticket-id>",
      "test-data.md",
      "content-plan.json",
      "Preconditions",
      "approval gate",
      "auto-execute",
      "the QA",
      "cms-test-data skill owns",
    ]) {
      expect(guide).not.toContain(anchor);
    }
  });

  test("distinguishes derived media URL segments from supplied ones", async () => {
    const guide = await createToolset(process.cwd()).usageGuide();

    expect(guide).toContain("derived URL segment uses `.png`");
    expect(guide).toContain("supplied `urlSegment` is used as given");
    expect(guide).not.toContain("the URL segment uses `.png` too");
  });

  test("states declared media extensions decide PNG capability before base type", async () => {
    const guide = await createToolset(process.cwd()).usageGuide();

    expect(guide).toContain("declared `supportedMediaExtensions` list decides by `png` membership");
    expect(guide).toContain("A `Video` base is an error only when no list is declared");
  });

  test("does not claim build warnings are only for dropped values", async () => {
    const guide = await createToolset(process.cwd()).usageGuide();

    expect(guide).not.toContain("warn only for supplied values that will be dropped");
    expect(guide).toContain("Media can also warn about content that is still produced");
  });
});

describe("load_schema guidance", () => {
  test("returns a short pointer to the usage guide without inlining it", async () => {
    const path = join(outDir, "types.episerverdata");
    writePackage(path, `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject><ContentTypeTransferObject><ID>1</ID><GUID>guid</GUID><Name>EmptyBlock</Name><DisplayName>Empty Block</DisplayName><Base>Block</Base><PropertyDefinitions /></ContentTypeTransferObject></ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`);
    const tools = createToolset(process.cwd());

    await expect(tools.loadSchema({ path })).resolves.toMatchObject({
      usageGuide: usageGuidePointer,
    });
  });
});
