import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createToolset } from "../src/mcp/tools";

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
  blockTypeGuid,
  blockTypeName,
  blockTypeModelTypeString,
  blockKind,
}: {
  id: number;
  name: string;
  dataType?: string;
  blockTypeGuid?: string;
  blockTypeName?: string;
  blockTypeModelTypeString?: string;
  blockKind?: "Value" | "List";
}): string {
  const blockTypeXml = blockTypeGuid && blockTypeName
    ? `<BlockType><GUID>${blockTypeGuid}</GUID><Name>${blockTypeName}</Name><ModelTypeString>${blockTypeModelTypeString ?? ""}</ModelTypeString></BlockType>`
    : "";
  const kindXml = blockKind ? `<Kind kind="${blockKind}"/>` : "";
  return `<PropertyDefinition>
    <ID>${id}</ID>
    <Name>${name}</Name>
    <Type xsi:type="${dataType === "Block" ? "BlockPropertyDefinitionType" : "PropertyDefinitionType"}"><DataType>${dataType}</DataType>${blockTypeXml}</Type>
    ${kindXml}
    <Required>false</Required>
    <LanguageSpecific>false</LanguageSpecific>
    <EditCaption>${name}</EditCaption>
  </PropertyDefinition>`;
}

function contentTypeXml(id: number, name: string, base: string, properties: string[]): string {
  return `<ContentTypeTransferObject>
    <ID>${id}</ID>
    <GUID>${name}-guid</GUID>
    <Name>${name}</Name>
    <DisplayName>${name}</DisplayName>
    <Base>${base}</Base>
    <PropertyDefinitions>${properties.join("")}</PropertyDefinitions>
  </ContentTypeTransferObject>`;
}

async function loadedTools() {
  const packagePath = join(outDir, "skeleton-roundtrip.episerverdata");
  writePackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    ${contentTypeXml(1, "ChildBlock", "Block", [
      propertyXml({ id: 101, name: "Label" }),
    ])}
    ${contentTypeXml(2, "ParentBlock", "Block", [
      propertyXml({ id: 201, name: "NestedValue", dataType: "Block", blockTypeGuid: "ChildBlock-guid", blockTypeName: "ChildBlock", blockTypeModelTypeString: "Tests.ChildBlock, Tests", blockKind: "Value" }),
      propertyXml({ id: 202, name: "NestedList", dataType: "Block", blockTypeGuid: "ChildBlock-guid", blockTypeName: "ChildBlock", blockTypeModelTypeString: "Tests.ChildBlock, Tests", blockKind: "List" }),
    ])}
    ${contentTypeXml(3, "NestedPage", "Page", [
      propertyXml({ id: 301, name: "Inline", dataType: "Block", blockTypeGuid: "ParentBlock-guid", blockTypeName: "ParentBlock", blockTypeModelTypeString: "Tests.ParentBlock, Tests", blockKind: "Value" }),
    ])}
    ${contentTypeXml(4, "SelfBlock", "Block", [
      propertyXml({ id: 401, name: "Title" }),
      propertyXml({ id: 402, name: "Inner", dataType: "Block", blockTypeGuid: "SelfBlock-guid", blockTypeName: "SelfBlock", blockTypeModelTypeString: "Tests.SelfBlock, Tests", blockKind: "Value" }),
    ])}
    ${contentTypeXml(5, "SelfPage", "Page", [
      propertyXml({ id: 501, name: "Root", dataType: "Block", blockTypeGuid: "SelfBlock-guid", blockTypeName: "SelfBlock", blockTypeModelTypeString: "Tests.SelfBlock, Tests", blockKind: "Value" }),
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

describe("describeContentType skeletons for nested inline blocks", () => {
  test("round-trip through validatePlan with nested Value and List block children", async () => {
    const tools = await loadedTools();
    const result = await tools.describeContentType({ name: "NestedPage" });
    const inline = result.skeleton!.items[0]!.properties!.Inline as Record<string, unknown>;

    expect(inline.NestedValue).toBeObject();
    expect(Array.isArray(inline.NestedValue)).toBe(false);
    expect(Array.isArray(inline.NestedList)).toBe(true);
    expect((inline.NestedList as unknown[])[0]).toBeObject();

    const validation = await tools.validatePlanTool({ plan: result.skeleton! });
    expect(validation.errors).toEqual([]);
  });

  test("round-trip omits self-referencing block children at the depth cap", async () => {
    const tools = await loadedTools();
    const result = await tools.describeContentType({ name: "SelfPage" });

    const validation = await tools.validatePlanTool({ plan: result.skeleton! });
    expect(validation.errors.map((error) => error.message)).not.toContain(
      "inline block nesting at items[0](item-1).properties.Root.Inner.Inner.Inner.Inner exceeds the maximum depth of 4"
    );
  });
});
