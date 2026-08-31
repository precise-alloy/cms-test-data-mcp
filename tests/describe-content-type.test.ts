import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createToolset } from "../src/mcp/tools";
import { parseSchema } from "../src/schema/parse";

const outDir = join(process.cwd(), ".test-output");

function writePackage(path: string, epiDefinitionXml: string): void {
  mkdirSync(outDir, { recursive: true });
  const zip = new AdmZip();
  zip.addFile("epiDefinition.xml", Buffer.from(epiDefinitionXml, "utf8"));
  zip.writeZip(path);
}

function propertyXml({
  id,
  name,
  dataType = "String",
  typeName,
  caption = name,
  helpText,
  editorHint,
  displayEditUI,
  existsOnModel,
  hidden,
  blockTypeGuid,
  blockTypeName,
  blockTypeModelTypeString,
  blockKind,
  required = false,
}: {
  id: number;
  name: string;
  dataType?: string;
  typeName?: string;
  caption?: string;
  helpText?: string;
  editorHint?: string;
  displayEditUI?: boolean;
  existsOnModel?: boolean;
  hidden?: boolean;
  blockTypeGuid?: string;
  blockTypeName?: string;
  blockTypeModelTypeString?: string;
  blockKind?: "Value" | "List";
  required?: boolean;
}): string {
  const blockTypeXml = blockTypeGuid && blockTypeName
    ? `<BlockType><GUID>${blockTypeGuid}</GUID><Name>${blockTypeName}</Name><ModelTypeString>${blockTypeModelTypeString ?? ""}</ModelTypeString></BlockType>`
    : "";
  const kindXml = blockKind ? `<Kind kind="${blockKind}"/>` : "";
  return `<PropertyDefinition>
    <ID>${id}</ID>
    <Name>${name}</Name>
    <Type xsi:type="${dataType === "Block" ? "BlockPropertyDefinitionType" : "PropertyDefinitionType"}"><DataType>${dataType}</DataType>${typeName ? `<TypeName>${typeName}</TypeName>` : ""}${hidden === undefined ? "" : `<Hidden>${hidden}</Hidden>`}${blockTypeXml}</Type>
    ${kindXml}
    <Required>${required}</Required>
    <LanguageSpecific>false</LanguageSpecific>
    <EditCaption>${caption}</EditCaption>
    ${helpText === undefined ? "" : `<HelpText>${helpText}</HelpText>`}
    ${editorHint === undefined ? "" : `<EditorHint>${editorHint}</EditorHint>`}
    ${displayEditUI === undefined ? "" : `<DisplayEditUI>${displayEditUI}</DisplayEditUI>`}
    ${existsOnModel === undefined ? "" : `<ExistsOnModel>${existsOnModel}</ExistsOnModel>`}
  </PropertyDefinition>`;
}

function contentTypeXml(name: string, base: string, properties: string[]): string {
  return `<ContentTypeTransferObject>
    <ID>${name === "IconItemBlock" ? 1 : 2}</ID>
    <GUID>${name}-guid</GUID>
    <Name>${name}</Name>
    <DisplayName>${name}</DisplayName>
    <Base>${base}</Base>
    <PropertyDefinitions>${properties.join("")}</PropertyDefinitions>
  </ContentTypeTransferObject>`;
}

async function loadedTools() {
  const packagePath = join(outDir, "describe.episerverdata");
  const properties = [
    propertyXml({ id: 1, name: "Title" }),
    propertyXml({ id: 2, name: "Description", dataType: "LongString" }),
    propertyXml({ id: 3, name: "Enabled", dataType: "Boolean" }),
    propertyXml({ id: 4, name: "Count", dataType: "Number" }),
    propertyXml({ id: 5, name: "Weight", dataType: "FloatNumber" }),
    propertyXml({ id: 6, name: "StartDate", dataType: "Date" }),
    propertyXml({ id: 7, name: "Body", typeName: "EPiServer.SpecializedProperties.PropertyXhtmlString" }),
    propertyXml({ id: 8, name: "PageLink", dataType: "PageReference" }),
    propertyXml({ id: 9, name: "RelatedItems", typeName: "EPiServer.SpecializedProperties.PropertyContentReferenceList" }),
    propertyXml({ id: 10, name: "MainArea", typeName: "EPiServer.SpecializedProperties.PropertyContentArea" }),
    propertyXml({ id: 11, name: "Links", typeName: "EPiServer.SpecializedProperties.PropertyLinkCollection" }),
    propertyXml({ id: 12, name: "ExternalUrl", typeName: "EPiServer.SpecializedProperties.PropertyUrl" }),
    propertyXml({ id: 13, name: "Icon", dataType: "Block", caption: "Icon", blockTypeGuid: "IconItemBlock-guid", blockTypeName: "IconItemBlock", blockTypeModelTypeString: "Tests.IconItemBlock, Tests, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null" }),
    propertyXml({ id: 14, name: "IconSize", dataType: "Number", caption: "Icon size", helpText: "Choose size in CMS edit mode." }),
    propertyXml({ id: 15, name: "HeroImage", dataType: "ContentReference", editorHint: "image" }),
    propertyXml({ id: 16, name: "DamAsset", dataType: "ContentReference", editorHint: "acmedamplugin" }),
    propertyXml({ id: 17, name: "MetaContentType", caption: "Content type" }),
    propertyXml({ id: 18, name: "HeaderHorizontalAlignment", dataType: "Number", caption: "Header alignment" }),
    propertyXml({ id: 19, name: "TopMargin", displayEditUI: false }),
    propertyXml({ id: 20, name: "Mystery", dataType: "UnknownType", existsOnModel: false, hidden: true }),
    propertyXml({ id: 21, name: "Features", dataType: "Block", blockTypeGuid: "IconItemBlock-guid", blockTypeName: "IconItemBlock", blockTypeModelTypeString: "Tests.IconItemBlock, Tests, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null", blockKind: "List" }),
  ];
  writePackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    ${contentTypeXml("IconItemBlock", "Block", properties)}
    ${contentTypeXml("EmptyBlock", "Block", [])}
    ${contentTypeXml("AssetFile", "Media", [])}
    ${contentTypeXml("RequiredUnsupportedBlock", "Block", [
      propertyXml({ id: 22, name: "RequiredMystery", dataType: "UnknownType", required: true }),
    ])}
  </ArrayOfContentTypeTransferObject></contenttypes>
</exportDefinition>`);
  const tools = createToolset(process.cwd());
  await tools.loadSchema({ path: packagePath });
  return tools;
}

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("describeContentType", () => {
  test("lists every property and explains every skeleton omission", async () => {
    const result = await (await loadedTools()).describeContentType({ name: "IconItemBlock" });

    expect(result.properties).toHaveLength(21);
    const skeletonProperties = result.skeleton!.items[0]!.properties!;
    expect(Object.keys(skeletonProperties).length).toBe(20);
    for (const property of result.properties!.filter((p) => !(p.name in skeletonProperties))) {
      expect(property.skeletonOmitted).toBe(true);
      expect(property.skeletonOmissionReason).toEqual(expect.any(String));
      expect(property.skeletonOmissionReason!.length).toBeGreaterThan(0);
    }
    expect(result.properties!.filter((p) => p.skeletonOmitted).map((p) => p.name).sort()).toEqual(["Mystery"]);
  });

  test("explains inline blocks, all integer fields, visibility, and editor hints without omitting fillable values", async () => {
    const result = await (await loadedTools()).describeContentType({ name: "IconItemBlock" });
    const byName = new Map(result.properties!.map((property) => [property.name, property]));
    const skeletonProperties = result.skeleton!.items[0]!.properties!;

    expect(byName.get("Icon")!.notes).toEqual([]);
    expect(byName.get("Icon")!.skeletonOmissionReason).toBeUndefined();
    expect(skeletonProperties.Icon).toBeObject();
    const intNote = "Integer property. If this is a selection/enum field in the CMS, the export carries no label mapping — confirm the legal values in CMS edit mode before relying on a specific number.";
    expect(byName.get("IconSize")!.notes).toContain(intNote);
    expect(byName.get("HeaderHorizontalAlignment")!.notes).toContain(intNote);
    expect(skeletonProperties.IconSize).toBe(0);
    expect(skeletonProperties.HeaderHorizontalAlignment).toBe(0);
    expect(byName.get("MetaContentType")!.notes).toEqual([]);
    expect(skeletonProperties.MetaContentType).toBe("...");
    expect(byName.get("TopMargin")).toMatchObject({
      displayEditUI: false,
      notes: expect.arrayContaining(["DisplayEditUI=false: not shown in CMS edit UI."]),
    });
    expect(skeletonProperties.TopMargin).toBe("...");
    expect(byName.get("Mystery")).toMatchObject({
      existsOnModel: false,
      hidden: true,
      notes: expect.arrayContaining([
        "Hidden property.",
        "ExistsOnModel=false: exported property is not present on the current content model.",
        "Unproven property type: no round-trip evidence — will be left empty.",
      ]),
      skeletonOmitted: true,
      skeletonOmissionReason: "Unproven property type: no round-trip evidence — will be left empty.",
    });
    for (const [name, hint] of [["HeroImage", "image"], ["DamAsset", "acmedamplugin"]] as const) {
      expect(byName.get(name)).toMatchObject({
        editorHint: hint,
        notes: expect.arrayContaining([`EditorHint "${hint}" (from the export; meaning is site-specific).`]),
      });
      expect(skeletonProperties[name]).toEqual({ ref: "<key>" });
    }
    expect(result.limitations).toContain("Raster image media is generated: each media item produces a placeholder PNG (default 1280×720; set image.width/height to override). SVG, PDF and video media are not generated. Image-capable media types: AssetFile. ContentArea [AllowedTypes] is absent from the export, so the tool cannot determine which references require media.");
  });

  test("returns a valid empty skeleton for content types with zero properties", async () => {
    const result = await (await loadedTools()).describeContentType({ name: "EmptyBlock" });

    expect(result.properties).toEqual([]);
    expect(result.skeleton).toMatchObject({
      planId: "<plan-id>",
      items: [{ key: "item-1", type: "EmptyBlock", name: "<display name>", properties: {} }],
    });
  });

  test("reports required properties the skeleton cannot supply", async () => {
    const tools = await loadedTools();
    const withUnsuppliedRequired = await tools.describeContentType({ name: "RequiredUnsupportedBlock" });
    const withoutUnsuppliedRequired = await tools.describeContentType({ name: "EmptyBlock" });

    expect(withUnsuppliedRequired.limitations).toContain(
      "These properties are required but cannot be supplied, so validate_plan will report them missing: RequiredMystery. Their serialization is unproven or they sit past the nesting cap; the CMS import still needs them set by hand."
    );
    expect(withoutUnsuppliedRequired.limitations).not.toContainEqual(
      expect.stringContaining("required but cannot be supplied")
    );
  });

  test("validation and build warnings fire only when supplied values are dropped", async () => {
    const tools = await loadedTools();
    const plan = {
      planId: "describe-warnings",
      items: [{
        key: "item",
        type: "IconItemBlock",
        name: "Item",
        properties: {
          // Icon is a realistic inline block (IconItemBlock); supplying an unknown property is an error
          Icon: { unsupported: true },
          IconSize: 1,
          HeroImage: { ref: "media" },
          Mystery: "legacy",
        },
      }, {
        key: "media",
        type: "EmptyBlock",
        name: "Media",
      }],
    };

    const validation = await tools.validatePlanTool({ plan });
    // Icon: { unsupported: true } → "unsupported" is not a property on IconItemBlock → error
    expect(validation.errors).toContainEqual(expect.objectContaining({
      level: "error",
      message: expect.stringContaining(`"unsupported" does not exist on IconItemBlock`),
    }));
    // Mystery is an unproven property → warning
    expect(validation.warnings.map((warning) => warning.message)).toContain(
      "Mystery: Unproven property type: no round-trip evidence — will be left empty."
    );
    // The old "inline block serialization is not supported" warning must not appear
    expect(validation.warnings.map((w) => w.message)).not.toContain(
      "Icon: Block-valued property: inline block serialization is not supported."
    );

    const built = await tools.buildPackage({ plan, outputPath: join(outDir, "describe-warnings.episerverdata") });
    // build is blocked because of the validation error on Icon
    expect(built.written).toBe(false);
    expect(built.errors).toContainEqual(expect.objectContaining({
      level: "error",
      message: expect.stringContaining(`"unsupported" does not exist on IconItemBlock`),
    }));
  });

  test("validatePlan rejects a linkCollection entry missing text", async () => {
    const validation = await (await loadedTools()).validatePlanTool({
      plan: {
        planId: "missing-link-text",
        items: [{
          key: "item",
          type: "IconItemBlock",
          name: "Item",
          properties: {
            Links: [{ href: "https://example.com" }],
          },
        }],
      },
    });

    expect(validation.errors).toContainEqual({
      level: "error",
      path: "items[0](item).properties.Links",
      message: "text field expects a string, got undefined",
    });
  });

  test("validatePlan rejects a linkCollection entry with neither href nor ref", async () => {
    const validation = await (await loadedTools()).validatePlanTool({
      plan: {
        planId: "missing-link-target",
        items: [{
          key: "item",
          type: "IconItemBlock",
          name: "Item",
          properties: {
            Links: [{ text: "Example" }],
          },
        }],
      },
    });

    expect(validation.errors).toContainEqual({
      level: "error",
      path: "items[0](item).properties.Links",
      message: "linkCollection entry expects href or ref",
    });
  });

  test("parseSchema populates blockType on the Icon property from the fixture XML", async () => {
    // Re-use the same package the other tests already load so no extra fixture is needed.
    // We call parseSchema directly so the assertion exercises the parser, not a hand-built object.
    const packagePath = join(outDir, "describe.episerverdata");
    await loadedTools(); // writes the package as a side-effect
    const schema = parseSchema(packagePath);
    const iconProp = schema.types["IconItemBlock"]!.properties.find((p) => p.name === "Icon");
    expect(iconProp).toBeDefined();
    expect(iconProp!.blockType).toEqual({
      guid: "IconItemBlock-guid",
      name: "IconItemBlock",
      modelTypeString: "Tests.IconItemBlock, Tests, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
    });
  });

  test("validatePlan returns diagnostics for non-object linkCollection entries", async () => {
    const tools = await loadedTools();
    for (const entry of [null, 42, "str", undefined]) {
      const validation = await tools.validatePlanTool({
        plan: {
          planId: "invalid-link-entry",
          items: [{
            key: "item",
            type: "IconItemBlock",
            name: "Item",
            properties: {
              Links: [entry],
            },
          }],
        },
      });

      expect(validation.errors).toEqual(expect.arrayContaining([
        {
          level: "error",
          path: "items[0](item).properties.Links",
          message: "text field expects a string, got undefined",
        },
        {
          level: "error",
          path: "items[0](item).properties.Links",
          message: "linkCollection entry expects href or ref",
        },
      ]));
    }
  });

  test("skeleton shows an object for a Value block property and an array for a List block property", async () => {
    const result = await (await loadedTools()).describeContentType({ name: "IconItemBlock" });
    const skeletonProperties = result.skeleton!.items[0]!.properties!;

    // Icon is Kind=Value (default) — its skeleton entry must be a plain object.
    expect(skeletonProperties.Icon).toBeObject();
    expect(Array.isArray(skeletonProperties.Icon)).toBe(false);

    // Features is Kind=List — its skeleton entry must be an array containing one object.
    expect(Array.isArray(skeletonProperties.Features)).toBe(true);
    expect((skeletonProperties.Features as unknown[]).length).toBe(1);
    expect((skeletonProperties.Features as unknown[])[0]).toBeObject();
  });
});
