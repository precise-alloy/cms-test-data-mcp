import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createToolset } from "../src/mcp/tools";
import { parseXml } from "../src/xml/parse";
import { attr, childElements, firstChild, rawText } from "../src/xml/query";
import type { XElement } from "../src/xml/types";

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
  dataType,
  typeName,
  caption,
  helpText,
  editorHint,
  displayEditUI,
  existsOnModel,
  hidden,
  saved,
  assemblyName,
}: {
  id: number;
  name: string;
  dataType: string;
  typeName?: string;
  caption: string;
  helpText?: string;
  editorHint?: string;
  displayEditUI?: boolean;
  existsOnModel?: boolean;
  hidden?: boolean;
  saved?: string;
  assemblyName?: string;
}): string {
  return `<PropertyDefinition>
    <ID>${id}</ID>
    <Name>${name}</Name>
    <Type><DataType>${dataType}</DataType>${typeName ? `<TypeName>${typeName}</TypeName>` : ""}${assemblyName ? `<AssemblyName>${assemblyName}</AssemblyName>` : ""}${hidden === undefined ? "" : `<Hidden>${hidden}</Hidden>`}</Type>
    <Required>false</Required>
    <LanguageSpecific>false</LanguageSpecific>
    <EditCaption>${caption}</EditCaption>
    ${helpText === undefined ? "" : `<HelpText>${helpText}</HelpText>`}
    ${editorHint === undefined ? "" : `<EditorHint>${editorHint}</EditorHint>`}
    ${displayEditUI === undefined ? "" : `<DisplayEditUI>${displayEditUI}</DisplayEditUI>`}
    ${existsOnModel === undefined ? "" : `<ExistsOnModel>${existsOnModel}</ExistsOnModel>`}
    ${saved === undefined ? "" : `<Saved>${saved}</Saved>`}
  </PropertyDefinition>`;
}

function contentTypeXml({
  id,
  name,
  displayName,
  base,
  guid,
  created,
  properties,
}: {
  id: number;
  name: string;
  displayName: string;
  base: string;
  guid?: string;
  created?: string;
  properties: string[];
}): string {
  return `<ContentTypeTransferObject>
    <ID>${id}</ID>
    <GUID>${guid ?? `${name}-guid`}</GUID>
    <Name>${name}</Name>
    <DisplayName>${displayName}</DisplayName>
    <Base>${base}</Base>
    ${created === undefined ? "" : `<Created>${created}</Created>`}
    <PropertyDefinitions>${properties.join("")}</PropertyDefinitions>
  </ContentTypeTransferObject>`;
}

function decodeXmlEntities(segment: string): string {
  return segment
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&");
}

function descendants(el: XElement, name: string): XElement[] {
  return childElements(el).flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);
}

function propertyByName(root: XElement, name: string): XElement {
  const property = descendants(root, "RawProperty").find((el) => {
    const nameElement = firstChild(el, "Name");
    return nameElement !== undefined && decodeXmlEntities(rawText(nameElement)) === name;
  });
  if (!property) throw new Error(`propertyByName: missing ${name}`);
  return property;
}

function nestedValue(root: XElement, name: string): string {
  return decodeXmlEntities(rawText(firstChild(propertyByName(root, name), "Value")!));
}

async function loadedTools() {
  const packagePath = join(outDir, "query.episerverdata");
  writePackage(packagePath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes>
    <ArrayOfContentTypeTransferObject>
      ${contentTypeXml({
        id: 1,
        name: "LandingPage",
        displayName: "Landing Page",
        base: "Page",
        created: "2025-01-01T00:00:00.000+00:00",
        properties: [
          propertyXml({ id: 11, name: "IconSize", dataType: "Number", caption: "Icon size", helpText: "Choose icon scale in CMS edit mode.", saved: "2025-02-01T00:00:00.000+00:00" }),
          propertyXml({ id: 12, name: "HeroImage", dataType: "ContentReference", caption: "Hero image", helpText: "Select a hero image from assets.", editorHint: "image", saved: "2025-03-01T00:00:00.000+00:00" }),
          propertyXml({ id: 13, name: "RelatedPage", dataType: "ContentReference", caption: "Related page" }),
          propertyXml({ id: 14, name: "MigratedFrom", dataType: "String", caption: "Migrated from", displayEditUI: false, existsOnModel: false, hidden: true }),
        ],
      })}
      ${contentTypeXml({
        id: 2,
        name: "IconItemBlock",
        displayName: "Icon Item Block",
        base: "Block",
        created: "2025-02-01T00:00:00.000+00:00",
        properties: [
          propertyXml({ id: 21, name: "Icon", dataType: "String", caption: "Icon", helpText: "Images &amp; media selected by café editors." }),
          propertyXml({ id: 22, name: "InlineBlock", dataType: "Block", caption: "Inline block" }),
          propertyXml({ id: 23, name: "Mystery", dataType: "UnknownType", caption: "Mystery" }),
        ],
      })}
    </ArrayOfContentTypeTransferObject>
  </contenttypes>
  <availablecontenttypes>
    <ArrayOfAllowedContentTypeDTO>
      <AllowedContentTypeDTO><ContentTypeName>LandingPage</ContentTypeName><Availability>Specific</Availability><RelatedContentTypeNames><string>LandingPage</string><string>IconItemBlock</string></RelatedContentTypeNames></AllowedContentTypeDTO>
    </ArrayOfAllowedContentTypeDTO>
  </availablecontenttypes>
</exportDefinition>`);
  const tools = createToolset(process.cwd());
  await tools.loadSchema({ path: packagePath });
  return tools;
}

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("querySchema", () => {
  test("returns bounded property-name matches with counts and reasons", async () => {
    const result = await (await loadedTools()).querySchema({ propertyNameContains: "Icon", limit: 5 });

    expect(result).toMatchObject({ total: 2, truncated: false, limit: 5 });
    expect(result.capabilities).toMatchObject({ helpTextProperties: 3, pageTreeAvailabilityEntries: 1 });
    expect(result.matchReasons).toContain("property name contains \"Icon\"");
    expect(result.results.map((item) => item.property?.name).sort()).toEqual(["Icon", "IconSize"]);
    expect(result.results.some((item) => "matchReasons" in item)).toBe(false);
    const intNoteRef = result.results.find((item) => item.property?.name === "IconSize")!.property!.noteRefs![0]!;
    expect(result.noteLegend![intNoteRef]).toBe(
      "Integer property. If this is a selection/enum field in the CMS, the export carries no label mapping — confirm the legal values in CMS edit mode before relying on a specific number."
    );
  });

  test("reports editor hints verbatim as site-specific export data", async () => {
    const result = await (await loadedTools()).querySchema({ helpTextContains: "assets", editorHint: "image" });

    expect(result.results.map((item) => item.property?.name)).toEqual(["HeroImage"]);
    const hintRef = result.results[0]!.property!.noteRefs![0]!;
    expect(result.noteLegend![hintRef]).toBe("EditorHint \"image\" (from the export; meaning is site-specific).");
  });

  test("finds visibility and model metadata", async () => {
    const result = await (await loadedTools()).querySchema({ displayEditUI: false, existsOnModel: false, hidden: true });

    expect(result.results.map((item) => item.property?.name)).toEqual(["MigratedFrom"]);
    const notes = result.results[0]!.property!.noteRefs!.map((ref) => result.noteLegend![ref]);
    expect(notes).toEqual(expect.arrayContaining([
      "Hidden property.",
      "DisplayEditUI=false: not shown in CMS edit UI.",
      "ExistsOnModel=false: exported property is not present on the current content model.",
    ]));
  });

  test("filters saved property metadata and created content-type metadata using exported timestamps", async () => {
    const result = await (await loadedTools()).querySchema({ savedSince: "2025-02-15T00:00:00.000+00:00", createdSince: "2025-01-10T00:00:00.000+00:00" });

    expect(result.results.map((item) => item.property?.name)).toEqual([]);

    const createdOnly = await (await loadedTools()).querySchema({ createdSince: "2025-01-10T00:00:00.000+00:00" });
    expect(createdOnly.results.map((item) => item.type.name)).toEqual(["IconItemBlock"]);
    expect(createdOnly.matchReasons).toContain("content type created on or after 2025-01-10T00:00:00.000+00:00");
  });

  test("rejects unparseable timestamp filters", async () => {
    await expect((await loadedTools()).querySchema({ savedSince: "last week" })).rejects.toThrow("querySchema: savedSince must be a parseable timestamp");
    await expect((await loadedTools()).querySchema({ createdSince: "last week" })).rejects.toThrow("querySchema: createdSince must be a parseable timestamp");
  });

  test("includes page-tree child availability with explicit non-ContentArea wording", async () => {
    const result = await (await loadedTools()).querySchema({ includeAvailability: true, kind: "page" });

    expect(result.results).toHaveLength(1);
    expect("pageTreeChildAvailability" in result.results[0]!).toBe(false);
    expect(result.pageTreeChildAvailabilityByType!.LandingPage).toEqual([
      {
        ownerContentTypeName: "LandingPage",
        ownerContentTypeId: 1,
        availability: "Specific",
        allowedTypeNames: ["LandingPage", "IconItemBlock"],
        note: "Page-tree child availability from <availablecontenttypes>; not ContentArea [AllowedTypes].",
      },
    ]);
  });

  test("truncates results at the requested limit", async () => {
    const result = await (await loadedTools()).querySchema({ limit: 1 });

    expect(result.total).toBeGreaterThan(1);
    expect(result.truncated).toBe(true);
    expect(result.limit).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  test("truncates results by byte budget after removing repeated notes and availability", async () => {
    const result = await (await loadedTools()).querySchema({ propertyNameContains: "i", includeAvailability: true, limit: 100, responseByteBudget: 2000 });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result, null, 2), "utf8")).toBeLessThanOrEqual(2000);
    if (result.pageTreeChildAvailabilityByType !== undefined) {
      expect(result.pageTreeChildAvailabilityByType).toEqual(expect.any(Object));
    }
    expect(result.results.some((item) => "pageTreeChildAvailability" in item)).toBe(false);
    const firstRef = result.results.find((item) => item.property?.noteRefs?.length)?.property!.noteRefs![0]!;
    expect(firstRef).toMatch(/^n\d+$/);
    expect(result.noteLegend![firstRef]).toEqual(expect.any(String));
  });

  test("truncates non-ASCII payloads by UTF-8 byte budget", async () => {
    const responseByteBudget = 3338;
    const result = await (await loadedTools()).querySchema({ propertyNameContains: "i", includeAvailability: true, limit: 100, responseByteBudget });
    const json = JSON.stringify(result, null, 2);
    const payloadBytes = Buffer.byteLength(json, "utf8");

    expect(result.results.map((item) => item.property?.name)).toContain("Icon");
    expect(json).toContain("Images & media selected by café editors.");
    expect(json.length).toBeLessThan(payloadBytes);
    expect(payloadBytes).toBeLessThanOrEqual(responseByteBudget);
    expect(result).toMatchObject({ total: 5, truncated: true, limit: 100 });
  });

  test("fits zero-result responses with overlong filter metadata within the byte budget", async () => {
    const result = await (await loadedTools()).querySchema({ propertyNameContains: "é".repeat(5000), responseByteBudget: 260 });

    expect(result).toMatchObject({ total: 0, truncated: true, limit: 50, results: [] });
    expect(result.capabilities).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(result, null, 2), "utf8")).toBeLessThanOrEqual(260);
  });

  test("matches entity-decoded schema text", async () => {
    const result = await (await loadedTools()).querySchema({ helpTextContains: "Images & media" });

    expect(result.results.map((item) => item.property?.name)).toEqual(["Icon"]);
    expect(result.results[0]!.property!.helpText).toBe("Images & media selected by café editors.");
  });

  test("filters by type name, caption, and value kind and clamps large limits", async () => {
    const result = await (await loadedTools()).querySchema({ typeNameContains: "Landing", captionContains: "Hero", valueKind: "contentRef", limit: 500 });

    expect(result.limit).toBe(100);
    expect(result.results.map((item) => `${item.type.name}.${item.property?.name}`)).toEqual(["LandingPage.HeroImage"]);
    expect(result.matchReasons).toEqual(expect.arrayContaining([
      "type name contains \"Landing\"",
      "caption contains \"Hero\"",
      "valueKind is \"contentRef\"",
    ]));
  });

  test("build_package escapes decoded schema property metadata once", async () => {
    const schemaPath = join(outDir, "escaped-schema.episerverdata");
    writePackage(schemaPath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes>
    <ArrayOfContentTypeTransferObject>
      ${contentTypeXml({
        id: 1,
        name: "LandingPage",
        displayName: "Landing Page",
        base: "Page",
        properties: [
          propertyXml({
            id: 11,
            name: "Title&amp;&lt;Text&gt;",
            dataType: "String&amp;&lt;Data&gt;",
            typeName: "Namespace.Property&amp;&lt;Type&gt;",
            assemblyName: "Assembly&amp;&lt;Name&gt;",
            caption: "Title",
          }),
        ],
      })}
    </ArrayOfContentTypeTransferObject>
  </contenttypes>
</exportDefinition>`);
    const outputPath = join(outDir, "escaped-schema-output.episerverdata");
    const tools = createToolset(process.cwd());
    await tools.loadSchema({ path: schemaPath });

    await expect(tools.buildPackage({
      outputPath,
      plan: {
        planId: "escaped-schema",
        language: "en&x",
        items: [{ key: "home", type: "LandingPage", name: "Home", urlSegment: "a&b<c>d" }],
      },
    })).resolves.toMatchObject({ written: true });

    const epixXml = new AdmZip(outputPath).readAsText("epix.xml");
    expect(() => parseXml(epixXml)).not.toThrow();
    expect(epixXml).toContain("<Name>Title&amp;&lt;Text&gt;</Name>");
    expect(epixXml).toContain("<Type>String&amp;&lt;Data&gt;</Type>");
    expect(epixXml).toContain("<TypeName>Namespace.Property&amp;&lt;Type&gt;</TypeName>");
    expect(epixXml).toContain("<AssemblyName>Assembly&amp;&lt;Name&gt;</AssemblyName>");
    expect(epixXml).toContain("<Name>PageMasterLanguageBranch</Name>");
    expect(epixXml).toContain("<Name>PageLanguageBranch</Name>");
    expect(epixXml).toContain("<Value>en&amp;x</Value>");
    expect(epixXml).toContain("<Name>PageURLSegment</Name>");
    expect(epixXml).toContain("<Value>a&amp;b&lt;c&gt;d</Value>");
    expect(epixXml).not.toContain("<Name>Title&<Text></Name>");
    expect(epixXml).not.toContain("<Value>en&x</Value>");
    expect(epixXml).not.toContain("<Value>a&b<c>d</Value>");
    expect(epixXml).not.toContain("Title&amp;amp;");
    expect(epixXml).not.toContain("String&amp;amp;");
    expect(epixXml).not.toContain("Namespace.Property&amp;amp;");
    expect(epixXml).not.toContain("Assembly&amp;amp;");
    expect(epixXml).not.toContain("en&amp;amp;");
    expect(epixXml).not.toContain("a&amp;amp;");
  });

  test("build_package emits content-type custom data as parseable nested XML", async () => {
    const literal = "A&B<c>d";
    const schemaPath = join(outDir, "nested-type-name.episerverdata");
    writePackage(schemaPath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes>
    <ArrayOfContentTypeTransferObject>
      ${contentTypeXml({
        id: 1,
        guid: "11111111-1111-1111-1111-111111111111",
        name: "A&amp;B&lt;c&gt;d",
        displayName: "Landing Page",
        base: "Page",
        properties: [],
      })}
    </ArrayOfContentTypeTransferObject>
  </contenttypes>
</exportDefinition>`);
    const outputPath = join(outDir, "nested-type-name-output.episerverdata");
    const tools = createToolset(process.cwd());
    await tools.loadSchema({ path: schemaPath });

    await expect(tools.buildPackage({
      outputPath,
      plan: {
        planId: "nested-type-name",
        items: [{ key: "home", type: literal, name: "Home" }],
      },
    })).resolves.toMatchObject({ written: true });

    const epixXml = new AdmZip(outputPath).readAsText("epix.xml");
    expect(epixXml).toContain("&lt;string&gt;A&amp;amp;B&amp;lt;c&amp;gt;d&lt;/string&gt;");
    const outer = parseXml(epixXml);
    const pageType = propertyByName(outer.root, "PageTypeID");
    const customData = firstChild(pageType, "CustomData")!;
    const rawNameAndXml = firstChild(customData, "RawNameAndXml")!;
    const innerXml = decodeXmlEntities(rawText(firstChild(rawNameAndXml, "Xml")!));
    const inner = parseXml(innerXml);

    expect(inner.root.name).toBe("string");
    expect(rawText(inner.root)).toBe("A&amp;B&lt;c&gt;d");
    expect(decodeXmlEntities(rawText(inner.root))).toBe(literal);
  });

  test("build_package emits contentArea and linkCollection values as parseable nested XML", async () => {
    const literal = "A&B<c>d";
    const schemaPath = join(outDir, "nested-property-values.episerverdata");
    writePackage(schemaPath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes>
    <ArrayOfContentTypeTransferObject>
      ${contentTypeXml({
        id: 1,
        guid: "11111111-1111-1111-1111-111111111111",
        name: "LandingPage",
        displayName: "Landing Page",
        base: "Page",
        properties: [
          propertyXml({ id: 11, name: "MainArea", dataType: "ContentArea", typeName: "EPiServer.SpecializedProperties.PropertyContentArea", caption: "Main area" }),
          propertyXml({ id: 12, name: "Links", dataType: "LinkCollection", typeName: "EPiServer.SpecializedProperties.PropertyLinkCollection", caption: "Links" }),
        ],
      })}
      ${contentTypeXml({
        id: 2,
        guid: "22222222-2222-2222-2222-222222222222",
        name: "TeaserBlock",
        displayName: "Teaser Block",
        base: "Block",
        properties: [],
      })}
    </ArrayOfContentTypeTransferObject>
  </contenttypes>
</exportDefinition>`);
    const outputPath = join(outDir, "nested-property-values-output.episerverdata");
    const tools = createToolset(process.cwd());
    await tools.loadSchema({ path: schemaPath });

    await expect(tools.buildPackage({
      outputPath,
      plan: {
        planId: "nested-property-values",
        items: [
          {
            key: "home",
            type: "LandingPage",
            name: "Home",
            properties: {
              MainArea: [{ ref: "teaser", displayOption: literal }],
              Links: [{ text: literal, href: `https://example.com/?q=${literal}` }],
            },
          },
          { key: "teaser", type: "TeaserBlock", name: literal },
        ],
      },
    })).resolves.toMatchObject({ written: true });

    const outer = parseXml(new AdmZip(outputPath).readAsText("epix.xml"));
    const contentAreaXml = nestedValue(outer.root, "MainArea");
    const contentArea = parseXml(contentAreaXml);
    expect(contentArea.root.name).toBe("div");
    expect(attr(contentArea.root, "data-contentname")).toBe("A&amp;B&lt;c&gt;d");
    expect(attr(contentArea.root, "data-epi-content-display-option")).toBe("A&amp;B&lt;c&gt;d");
    expect(decodeXmlEntities(attr(contentArea.root, "data-contentname")!)).toBe(literal);
    expect(decodeXmlEntities(attr(contentArea.root, "data-epi-content-display-option")!)).toBe(literal);

    const linkCollectionXml = nestedValue(outer.root, "Links");
    const linkCollection = parseXml(linkCollectionXml);
    const link = firstChild(firstChild(linkCollection.root, "li")!, "a")!;
    expect(attr(link, "href")).toBe("https://example.com/?q=A&amp;B&lt;c&gt;d");
    expect(attr(link, "title")).toBe("A&amp;B&lt;c&gt;d");
    expect(rawText(link)).toBe("A&amp;B&lt;c&gt;d");
    expect(decodeXmlEntities(attr(link, "href")!)).toBe(`https://example.com/?q=${literal}`);
    expect(decodeXmlEntities(attr(link, "title")!)).toBe(literal);
    expect(decodeXmlEntities(rawText(link))).toBe(literal);
  });

  test("build_package emits quoted contentArea and linkCollection values as parseable nested XML attributes", async () => {
    const literal = "A\"B&C<d>";
    const schemaPath = join(outDir, "nested-property-values-with-quotes.episerverdata");
    writePackage(schemaPath, `<?xml version="1.0" encoding="utf-8"?>
<exportDefinition culture="en" version="4">
  <contenttypes>
    <ArrayOfContentTypeTransferObject>
      ${contentTypeXml({
        id: 1,
        guid: "11111111-1111-1111-1111-111111111111",
        name: "LandingPage",
        displayName: "Landing Page",
        base: "Page",
        properties: [
          propertyXml({ id: 11, name: "MainArea", dataType: "ContentArea", typeName: "EPiServer.SpecializedProperties.PropertyContentArea", caption: "Main area" }),
          propertyXml({ id: 12, name: "Links", dataType: "LinkCollection", typeName: "EPiServer.SpecializedProperties.PropertyLinkCollection", caption: "Links" }),
        ],
      })}
      ${contentTypeXml({
        id: 2,
        guid: "22222222-2222-2222-2222-222222222222",
        name: "TeaserBlock",
        displayName: "Teaser Block",
        base: "Block",
        properties: [],
      })}
    </ArrayOfContentTypeTransferObject>
  </contenttypes>
</exportDefinition>`);
    const outputPath = join(outDir, "nested-property-values-with-quotes-output.episerverdata");
    const tools = createToolset(process.cwd());
    await tools.loadSchema({ path: schemaPath });

    await expect(tools.buildPackage({
      outputPath,
      plan: {
        planId: "nested-property-values-with-quotes",
        items: [
          {
            key: "home",
            type: "LandingPage",
            name: "Home",
            properties: {
              MainArea: [{ ref: "teaser", displayOption: literal }],
              Links: [{ text: literal, href: `https://example.com/?q=${literal}` }],
            },
          },
          { key: "teaser", type: "TeaserBlock", name: literal },
        ],
      },
    })).resolves.toMatchObject({ written: true });

    const outer = parseXml(new AdmZip(outputPath).readAsText("epix.xml"));
    const contentArea = parseXml(nestedValue(outer.root, "MainArea"));
    expect(contentArea.root.name).toBe("div");
    expect(attr(contentArea.root, "data-contentname")).toBe("A&quot;B&amp;C&lt;d&gt;");
    expect(attr(contentArea.root, "data-epi-content-display-option")).toBe("A&quot;B&amp;C&lt;d&gt;");
    expect(decodeXmlEntities(attr(contentArea.root, "data-contentname")!)).toBe(literal);
    expect(decodeXmlEntities(attr(contentArea.root, "data-epi-content-display-option")!)).toBe(literal);

    const linkCollection = parseXml(nestedValue(outer.root, "Links"));
    const link = firstChild(firstChild(linkCollection.root, "li")!, "a")!;
    expect(attr(link, "href")).toBe("https://example.com/?q=A&quot;B&amp;C&lt;d&gt;");
    expect(attr(link, "title")).toBe("A&quot;B&amp;C&lt;d&gt;");
    expect(rawText(link)).toBe("A\"B&amp;C&lt;d&gt;");
    expect(decodeXmlEntities(attr(link, "href")!)).toBe(`https://example.com/?q=${literal}`);
    expect(decodeXmlEntities(attr(link, "title")!)).toBe(literal);
    expect(decodeXmlEntities(rawText(link))).toBe(literal);
  });
});
