import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { parseSchema } from "../src/schema/parse";

const outDir = join(process.cwd(), ".test-output");

function schemaPackage(): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "blocktype.episerverdata");
  const def = `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject>
<ContentTypeTransferObject><ID>1</ID><GUID>card-guid</GUID><Name>CardBlock</Name>
<DisplayName>Card</DisplayName><Base>Block</Base><PropertyDefinitions>
<PropertyDefinition><ID>10</ID><Name>Heading</Name><Type><DataType>LongString</DataType></Type>
<Required>false</Required><Tab><ID>0</ID></Tab><EditCaption>Heading</EditCaption><LanguageSpecific>false</LanguageSpecific></PropertyDefinition>
</PropertyDefinitions></ContentTypeTransferObject>
<ContentTypeTransferObject><ID>2</ID><GUID>page-guid</GUID><Name>LandingPage</Name>
<DisplayName>Landing</DisplayName><Base>Page</Base><PropertyDefinitions>
<PropertyDefinition><ID>20</ID><Name>HeroCard</Name>
<Type xsi:type="BlockPropertyDefinitionType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DataType>Block</DataType><Name>CardBlock</Name>
<BlockType><GUID>card-guid</GUID><Name>CardBlock</Name>
<ModelTypeString>Acme.Features.CardBlock, Acme</ModelTypeString></BlockType></Type>
<Kind kind="Value" /><Required>false</Required><Tab><ID>0</ID></Tab>
<EditCaption>Hero card</EditCaption><LanguageSpecific>false</LanguageSpecific></PropertyDefinition>
</PropertyDefinitions></ContentTypeTransferObject>
</ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`;
  const zip = new AdmZip();
  zip.addFile("epiDefinition.xml", Buffer.from(def, "utf8"));
  zip.addFile("epix.xml", Buffer.from(`<export culture="en-US" version="4" />`, "utf8"));
  zip.writeZip(path);
  return path;
}

function parseFixture() {
  return parseSchema(schemaPackage());
}

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("the block type behind an inline block property", () => {
  test("every inline block property names a block type present in the schema", () => {
    const schema = parseFixture();
    const blockProps = Object.values(schema.types)
      .flatMap((t) => t.properties)
      .filter((p) => p.valueKind === "block");

    expect(blockProps.length).toBeGreaterThan(0);
    for (const p of blockProps) {
      expect(p.blockType).toBeDefined();
      expect(schema.types[p.blockType!.name]).toBeDefined();
    }
  });

  test("the model type string yields the class name used in TypeName", () => {
    const schema = parseFixture();
    const p = Object.values(schema.types)
      .flatMap((t) => t.properties)
      .find((p) => p.valueKind === "block")!;
    const className = p.blockType!.modelTypeString.split(",")[0]!.trim();
    expect(className.endsWith(p.blockType!.name)).toBe(true);
  });

  test("a non-block property has no blockType", () => {
    const schema = parseFixture();
    const p = Object.values(schema.types)
      .flatMap((t) => t.properties)
      .find((p) => p.valueKind === "text")!;
    expect(p.blockType).toBeUndefined();
  });
});
