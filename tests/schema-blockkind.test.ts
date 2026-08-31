import { describe, expect, test } from "bun:test";
import { parseSchema } from "../src/schema/parse";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

/** Minimal content-type export carrying one Value block and one List block. */
function schemaPackage(): string {
  const def = `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject>
<ContentTypeTransferObject><ID>1</ID><GUID>bt-guid</GUID><Name>ItemBlock</Name>
<DisplayName>Item</DisplayName><Base>Block</Base><PropertyDefinitions>
<PropertyDefinition><ID>10</ID><Name>Heading</Name><Type><DataType>LongString</DataType></Type>
<Kind kind="Value" /><Required>false</Required><Tab><ID>0</ID></Tab>
<EditCaption>Heading</EditCaption><LanguageSpecific>false</LanguageSpecific></PropertyDefinition>
</PropertyDefinitions></ContentTypeTransferObject>
<ContentTypeTransferObject><ID>2</ID><GUID>page-guid</GUID><Name>HomePage</Name>
<DisplayName>Home</DisplayName><Base>Page</Base><PropertyDefinitions>
<PropertyDefinition><ID>20</ID><Name>Single</Name>
<Type xsi:type="BlockPropertyDefinitionType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DataType>Block</DataType><Name>ItemBlock</Name>
<BlockType><GUID>bt-guid</GUID><Name>ItemBlock</Name>
<ModelTypeString>Acme.ItemBlock, Acme</ModelTypeString></BlockType></Type>
<Kind kind="Value" /><Required>false</Required><Tab><ID>0</ID></Tab>
<EditCaption>Single</EditCaption><LanguageSpecific>false</LanguageSpecific></PropertyDefinition>
<PropertyDefinition><ID>21</ID><Name>Many</Name>
<Type xsi:type="BlockPropertyDefinitionType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DataType>Block</DataType><Name>ItemBlock</Name>
<BlockType><GUID>bt-guid</GUID><Name>ItemBlock</Name>
<ModelTypeString>Acme.ItemBlock, Acme</ModelTypeString></BlockType></Type>
<Kind kind="List" /><Required>false</Required><Tab><ID>0</ID></Tab>
<EditCaption>Many</EditCaption><LanguageSpecific>false</LanguageSpecific></PropertyDefinition>
<PropertyDefinition><ID>22</ID><Name>NoKind</Name>
<Type xsi:type="BlockPropertyDefinitionType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DataType>Block</DataType><Name>ItemBlock</Name>
<BlockType><GUID>bt-guid</GUID><Name>ItemBlock</Name>
<ModelTypeString>Acme.ItemBlock, Acme</ModelTypeString></BlockType></Type>
<Required>false</Required><Tab><ID>0</ID></Tab>
<EditCaption>NoKind</EditCaption><LanguageSpecific>false</LanguageSpecific></PropertyDefinition>
</PropertyDefinitions></ContentTypeTransferObject>
</ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`;
  const dir = mkdtempSync(join(tmpdir(), "blockkind-"));
  const path = join(dir, "types.episerverdata");
  const zip = new AdmZip();
  zip.addFile("epiDefinition.xml", Buffer.from(def, "utf8"));
  zip.addFile("epix.xml", Buffer.from(`<export culture="en-US" version="4" />`, "utf8"));
  zip.writeZip(path);
  return path;
}

describe("the Kind of a block property", () => {
  test("is read as List when the export says List", () => {
    const path = schemaPackage();
    try {
      const p = parseSchema(path).types.HomePage!.properties.find((x) => x.name === "Many")!;
      expect(p.valueKind).toBe("block");
      expect(p.blockKind).toBe("List");
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("is read as Value when the export says Value", () => {
    const path = schemaPackage();
    try {
      const p = parseSchema(path).types.HomePage!.properties.find((x) => x.name === "Single")!;
      expect(p.blockKind).toBe("Value");
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("defaults to Value when the export carries no Kind", () => {
    const path = schemaPackage();
    try {
      const p = parseSchema(path).types.HomePage!.properties.find((x) => x.name === "NoKind")!;
      expect(p.blockKind).toBe("Value");
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("is not set for a property that is not a block", () => {
    const path = schemaPackage();
    try {
      const p = parseSchema(path).types.ItemBlock!.properties.find((x) => x.name === "Heading")!;
      expect(p.blockKind).toBeUndefined();
    } finally {
      rmSync(path, { force: true });
    }
  });
});
