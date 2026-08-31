import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { parseSchema } from "../src/schema/parse";

const outDir = join(process.cwd(), ".test-output");

function writeSchemaPackage(path: string, epiDefinitionXml: string | undefined): void {
  mkdirSync(outDir, { recursive: true });
  const zip = new AdmZip();
  if (epiDefinitionXml !== undefined) zip.addFile("epiDefinition.xml", Buffer.from(epiDefinitionXml, "utf8"));
  zip.writeZip(path);
}

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("parseSchema", () => {
  test("parses property metadata and page-tree child availability from epiDefinition.xml", () => {
    const packagePath = join(outDir, "metadata.episerverdata");
    writeSchemaPackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en-US" version="4">
  <contenttypes>
    <ArrayOfContentTypeTransferObject>
      <ContentTypeTransferObject>
        <ID>10</ID>
        <GUID>page-guid</GUID>
        <Name>ArticlePage</Name>
        <DisplayName>Article Page</DisplayName>
        <Description>Article description</Description>
        <GroupName>Pages</GroupName>
        <Base>Page</Base>
        <IsAvailable>true</IsAvailable>
        <SortOrder>25</SortOrder>
        <SupportedMediaExtensions>jpg,png</SupportedMediaExtensions>
        <VersionString>1.2.3</VersionString>
        <Created>2024-01-02T03:04:05.000+00:00</Created>
        <Saved>2024-02-03T04:05:06.000+00:00</Saved>
        <ModelTypeString>Site.ArticlePage</ModelTypeString>
        <PropertyDefinitions>
          <PropertyDefinition>
            <ID>101</ID>
            <Name>HeroImage</Name>
            <Type>
              <DataType>ContentReference</DataType>
              <Name>ContentReference</Name>
              <Hidden>true</Hidden>
            </Type>
            <Required>true</Required>
            <Tab><ID>7</ID><Name>Content</Name><DisplayName>Content tab</DisplayName><SortIndex>30</SortIndex></Tab>
            <HelpText>Choose a hero image.</HelpText>
            <Searchable>false</Searchable>
            <DefaultValueType>Inherited</DefaultValueType>
            <EditCaption>Hero image</EditCaption>
            <FieldOrder>4</FieldOrder>
            <DisplayEditUI>false</DisplayEditUI>
            <LanguageSpecific>true</LanguageSpecific>
            <EditorHint>image</EditorHint>
            <ExistsOnModel>false</ExistsOnModel>
            <Saved>2024-03-04T05:06:07.000+00:00</Saved>
          </PropertyDefinition>
        </PropertyDefinitions>
      </ContentTypeTransferObject>
      <ContentTypeTransferObject>
        <ID>11</ID>
        <GUID>block-guid</GUID>
        <Name>PromoBlock</Name>
        <DisplayName>Promo Block</DisplayName>
        <Base>Block</Base>
        <PropertyDefinitions />
      </ContentTypeTransferObject>
    </ArrayOfContentTypeTransferObject>
    <ArrayOfString />
  </contenttypes>
  <availablecontenttypes>
    <ArrayOfAllowedContentTypeDTO>
      <AllowedContentTypeDTO><ContentTypeName>ArticlePage</ContentTypeName><Availability>All</Availability><RelatedContentTypeNames /></AllowedContentTypeDTO>
      <AllowedContentTypeDTO><ContentTypeName>PromoBlock</ContentTypeName><Availability>None</Availability><RelatedContentTypeNames /></AllowedContentTypeDTO>
      <AllowedContentTypeDTO><ContentTypeName>ArticlePage</ContentTypeName><Availability>Specific</Availability><RelatedContentTypeNames><string>PromoBlock</string><string>ArticlePage</string></RelatedContentTypeNames></AllowedContentTypeDTO>
    </ArrayOfAllowedContentTypeDTO>
  </availablecontenttypes>
</exportDefinition>`);

    const schema = parseSchema(packagePath);
    const page = schema.types.ArticlePage!;
    const prop = page.properties[0]!;

    expect(page).toMatchObject({
      description: "Article description",
      groupName: "Pages",
      isAvailable: true,
      sortOrder: 25,
      supportedMediaExtensions: "jpg,png",
      versionString: "1.2.3",
      created: "2024-01-02T03:04:05.000+00:00",
      saved: "2024-02-03T04:05:06.000+00:00",
    });
    expect(prop).toMatchObject({
      helpText: "Choose a hero image.",
      displayEditUI: false,
      existsOnModel: false,
      hidden: true,
      fieldOrder: 4,
      searchable: false,
      defaultValueType: "Inherited",
      editorHint: "image",
      saved: "2024-03-04T05:06:07.000+00:00",
      tab: { id: 7, name: "Content", displayName: "Content tab", sortIndex: 30 },
    });

    expect(schema.childAvailability).toEqual([
      {
        ownerContentTypeName: "ArticlePage",
        ownerContentTypeId: 10,
        availability: "All",
        allowedTypeNames: [],
        note: "Page-tree child availability from <availablecontenttypes>; not ContentArea [AllowedTypes].",
      },
      {
        ownerContentTypeName: "PromoBlock",
        ownerContentTypeId: 11,
        availability: "None",
        allowedTypeNames: [],
        note: "Page-tree child availability from <availablecontenttypes>; not ContentArea [AllowedTypes].",
      },
      {
        ownerContentTypeName: "ArticlePage",
        ownerContentTypeId: 10,
        availability: "Specific",
        allowedTypeNames: ["PromoBlock", "ArticlePage"],
        note: "Page-tree child availability from <availablecontenttypes>; not ContentArea [AllowedTypes].",
      },
    ]);
    expect(page.childAvailability).toEqual([schema.childAvailability!.at(0)!, schema.childAvailability!.at(2)!]);
    expect(schema.capabilities).toEqual({
      helpTextProperties: 1,
      displayEditUIFalseProperties: 1,
      existsOnModelFalseProperties: 1,
      pageTreeAvailabilityEntries: 3,
      pageTreeAvailabilityByStatus: { All: 1, None: 1, Specific: 1 },
      absentMetadata: ["enum labels/values", "ContentArea [AllowedTypes]", "[ScaffoldColumn]"],
    });
  });

  test("does not invent content-type hidden flags or count missing availability statuses", () => {
    const packagePath = join(outDir, "missing-availability.episerverdata");
    writeSchemaPackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    <ContentTypeTransferObject>
      <ID>1</ID><GUID>guid</GUID><Name>PageWithAvailability</Name><DisplayName>Page With Availability</DisplayName><Base>Page</Base><PropertyDefinitions />
    </ContentTypeTransferObject>
  </ArrayOfContentTypeTransferObject></contenttypes>
  <availablecontenttypes><ArrayOfAllowedContentTypeDTO>
    <AllowedContentTypeDTO><ContentTypeName>PageWithAvailability</ContentTypeName><RelatedContentTypeNames /></AllowedContentTypeDTO>
  </ArrayOfAllowedContentTypeDTO></availablecontenttypes>
</exportDefinition>`);

    const schema = parseSchema(packagePath);

    expect("hidden" in schema.types.PageWithAvailability!).toBe(false);
    expect(schema.childAvailability![0]!.availability).toBeUndefined();
    expect(schema.capabilities!.pageTreeAvailabilityByStatus).toEqual({});
  });

  test("throws a clear error when epiDefinition.xml is missing", () => {
    const packagePath = join(outDir, "missing-definition.episerverdata");
    writeSchemaPackage(packagePath, undefined);

    expect(() => parseSchema(packagePath)).toThrow("parseSchema: missing epiDefinition.xml");
  });

  test("parses an export with zero content types", () => {
    const packagePath = join(outDir, "empty.episerverdata");
    writeSchemaPackage(packagePath, `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject /></contenttypes></exportDefinition>`);

    expect(parseSchema(packagePath).types).toEqual({});
  });

  test("parses a content type with zero properties", () => {
    const packagePath = join(outDir, "zero-properties.episerverdata");
    writeSchemaPackage(packagePath, `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject><ContentTypeTransferObject><ID>1</ID><GUID>guid</GUID><Name>EmptyBlock</Name><DisplayName>Empty Block</DisplayName><Base>Block</Base><PropertyDefinitions /></ContentTypeTransferObject></ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`);

    expect(parseSchema(packagePath).types.EmptyBlock!.properties).toEqual([]);
  });

  test("omits absent and empty help text", () => {
    const packagePath = join(outDir, "empty-help.episerverdata");
    writeSchemaPackage(packagePath, `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject><ContentTypeTransferObject><ID>1</ID><GUID>guid</GUID><Name>TextBlock</Name><DisplayName>Text Block</DisplayName><Base>Block</Base><PropertyDefinitions><PropertyDefinition><ID>1</ID><Name>NoHelp</Name><Type><DataType>String</DataType></Type><Required>false</Required><LanguageSpecific>false</LanguageSpecific><EditCaption>No Help</EditCaption></PropertyDefinition><PropertyDefinition><ID>2</ID><Name>EmptyHelp</Name><Type><DataType>String</DataType></Type><Required>false</Required><LanguageSpecific>false</LanguageSpecific><EditCaption>Empty Help</EditCaption><HelpText>   </HelpText></PropertyDefinition></PropertyDefinitions></ContentTypeTransferObject></ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`);

    const [absent, empty] = parseSchema(packagePath).types.TextBlock!.properties;
    expect(absent!.helpText).toBeUndefined();
    expect(empty!.helpText).toBeUndefined();
  });

  test("decodes recognized XML entities once without reinterpreting replacements", () => {
    const packagePath = join(outDir, "entity-decoding.episerverdata");
    writeSchemaPackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    <ContentTypeTransferObject>
      <ID>1</ID>
      <GUID>guid</GUID>
      <Name>EntityBlock</Name>
      <DisplayName>&#38;amp;|&#x26;amp;|&amp;lt;|&amp;#38;|&#38;lt;</DisplayName>
      <Description>&lt;|&gt;|&quot;|&apos;|&amp;</Description>
      <GroupName>&foo;|&|&#;</GroupName>
      <Base>Block</Base>
      <PropertyDefinitions />
    </ContentTypeTransferObject>
  </ArrayOfContentTypeTransferObject></contenttypes>
</exportDefinition>`);

    const entityBlock = parseSchema(packagePath).types.EntityBlock!;

    expect(entityBlock.displayName).toBe("&amp;|&amp;|&lt;|&#38;|&lt;");
    expect(entityBlock.description).toBe("<|>|\"|'|&");
    expect(entityBlock.groupName).toBe("&foo;|&|&#;");
  });

  test("preserves out-of-range numeric XML entities", () => {
    const packagePath = join(outDir, "out-of-range-entities.episerverdata");
    writeSchemaPackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    <ContentTypeTransferObject>
      <ID>1</ID>
      <GUID>guid</GUID>
      <Name>OutOfRangeBlock</Name>
      <Description>&#999999999;|&#1114112;</Description>
      <Base>Block</Base>
      <PropertyDefinitions />
    </ContentTypeTransferObject>
  </ArrayOfContentTypeTransferObject></contenttypes>
</exportDefinition>`);

    expect(() => parseSchema(packagePath)).not.toThrow();
    expect(parseSchema(packagePath).types.OutOfRangeBlock!.description).toBe("&#999999999;|&#1114112;");
  });

  test("preserves invalid XML character numeric entities and decodes valid XML character boundaries", () => {
    const packagePath = join(outDir, "xml-char-boundaries.episerverdata");
    writeSchemaPackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    <ContentTypeTransferObject>
      <ID>1</ID>
      <GUID>guid</GUID>
      <Name>XmlCharBoundaryBlock</Name>
      <DisplayName>&#x9;|&#xA;|&#xD;|&#x20;|&#xD7FF;|&#xE000;|&#xFFFD;|&#x10000;|&#x10FFFF;</DisplayName>
      <Description>&#xD800;|&#55296;|&#xDFFF;|&#0;|&#xFFFE;|&#xFFFF;|&#999999999;|&#1114112;</Description>
      <Base>Block</Base>
      <PropertyDefinitions />
    </ContentTypeTransferObject>
  </ArrayOfContentTypeTransferObject></contenttypes>
</exportDefinition>`);

    const boundaryBlock = parseSchema(packagePath).types.XmlCharBoundaryBlock!;

    expect(boundaryBlock.description).toBe("&#xD800;|&#55296;|&#xDFFF;|&#0;|&#xFFFE;|&#xFFFF;|&#999999999;|&#1114112;");
    expect(boundaryBlock.displayName).toBe(`\t|\n|\r| |\uD7FF|\uE000|\uFFFD|${String.fromCodePoint(0x10000)}|${String.fromCodePoint(0x10ffff)}`);
  });

  test("does not entity-decode CDATA schema text", () => {
    const packagePath = join(outDir, "cdata-entities.episerverdata");
    writeSchemaPackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes><ArrayOfContentTypeTransferObject>
    <ContentTypeTransferObject>
      <ID>1</ID>
      <GUID>guid</GUID>
      <Name>CdataBlock</Name>
      <Description><![CDATA[&lt;raw&gt; &amp; raw]]></Description>
      <Base>Block</Base>
      <PropertyDefinitions />
    </ContentTypeTransferObject>
  </ArrayOfContentTypeTransferObject></contenttypes>
</exportDefinition>`);

    expect(parseSchema(packagePath).types.CdataBlock!.description).toBe("&lt;raw&gt; &amp; raw");
  });

  test("keeps unknown property type names unproven", () => {
    const packagePath = join(outDir, "unknown-type.episerverdata");
    writeSchemaPackage(packagePath, `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject><ContentTypeTransferObject><ID>1</ID><GUID>guid</GUID><Name>MysteryBlock</Name><DisplayName>Mystery Block</DisplayName><Base>Block</Base><PropertyDefinitions><PropertyDefinition><ID>1</ID><Name>Mystery</Name><Type><DataType>Number</DataType><TypeName>Acme.Custom.Selection</TypeName></Type><Required>false</Required><LanguageSpecific>false</LanguageSpecific><EditCaption>Mystery</EditCaption></PropertyDefinition></PropertyDefinitions></ContentTypeTransferObject></ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`);

    expect(parseSchema(packagePath).types.MysteryBlock!.properties[0]!.valueKind).toBe("unproven");
  });
});
