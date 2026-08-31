import { parseXml } from "../xml/parse";
import { attr, childElements, firstChild, rawText } from "../xml/query";
import { readPackage } from "../pkg/read";
import { inferValueKind } from "../vocab/build";
import type { ChildAvailabilityInfo, ContentTypeInfo, ExportCapabilitySummary, PropertyInfo, PropertyTabInfo, SchemaIndex } from "./types";
import type { XElement } from "../xml/types";

export * from "./types";

const DEPENDENCY_KINDS = new Set(["contentRef", "contentRefList", "contentArea"]);

function kindOf(base: string): ContentTypeInfo["kind"] {
  if (base === "Page") return "page";
  if (base === "Block") return "block";
  if (["Media", "Image", "Video"].includes(base)) return "media";
  return "other";
}

function isXmlChar(codePoint: number): boolean {
  return codePoint === 0x9
    || codePoint === 0xa
    || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function decodeXmlEntities(segment: string): string {
  return segment.replace(/&(lt|gt|quot|apos|amp);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (entity: string, name: string | undefined, decimal: string | undefined, hex: string | undefined) => {
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return "\"";
    if (name === "apos") return "'";
    if (name === "amp") return "&";

    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    if (!Number.isInteger(codePoint) || !isXmlChar(codePoint)) return entity;
    return String.fromCodePoint(codePoint);
  });
}

function decodeSchemaText(raw: string): string {
  let out = "";
  let cursor = 0;
  for (const match of raw.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeXmlEntities(raw.slice(cursor, match.index));
    out += match[1] ?? "";
    cursor = match.index + match[0].length;
  }
  out += decodeXmlEntities(raw.slice(cursor));
  return out;
}

function text(el: XElement | undefined, child: string): string {
  if (!el) return "";
  const c = firstChild(el, child);
  return c ? decodeSchemaText(rawText(c)) : "";
}

function num(el: XElement | undefined, child: string): number {
  const v = text(el, child);
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

function optionalText(el: XElement | undefined, child: string): string | undefined {
  const v = text(el, child).trim();
  return v.length > 0 ? v : undefined;
}

function optionalNum(el: XElement | undefined, child: string): number | undefined {
  const v = optionalText(el, child);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

function optionalBool(el: XElement | undefined, child: string): boolean | undefined {
  const v = optionalText(el, child);
  return v === undefined ? undefined : v === "true";
}

function requiredNum(el: XElement | undefined, child: string, context: string): number {
  const v = text(el, child);
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`parseSchema: missing or unparseable <${child}> on ${context}`);
  return n;
}

function readTab(tabEl: XElement | undefined): PropertyTabInfo | undefined {
  const id = optionalNum(tabEl, "ID");
  if (id === undefined) return undefined;
  return {
    id,
    name: optionalText(tabEl, "Name"),
    displayName: optionalText(tabEl, "DisplayName"),
    sortIndex: optionalNum(tabEl, "SortIndex"),
  };
}

function readProperty(pd: XElement): PropertyInfo {
  const typeEl = firstChild(pd, "Type");
  const dataType = text(typeEl, "DataType");
  const typeName = text(typeEl, "TypeName") || undefined;
  const blockTypeEl = typeEl ? firstChild(typeEl, "BlockType") : undefined;
  const blockType = blockTypeEl
    ? {
        guid: text(blockTypeEl, "GUID"),
        name: text(blockTypeEl, "Name"),
        modelTypeString: text(blockTypeEl, "ModelTypeString"),
      }
    : undefined;
  const valueKind = inferValueKind(dataType, typeName);
  const kindAttr = firstChild(pd, "Kind")?.attrs.find((a) => a.name === "kind")?.rawValue;
  const blockKind = valueKind === "block" ? (kindAttr === "List" ? "List" : "Value") : undefined;
  const tab = readTab(firstChild(pd, "Tab"));
  return {
    id: requiredNum(pd, "ID", text(pd, "Name")),
    name: text(pd, "Name"),
    tabId: num(firstChild(pd, "Tab"), "ID"),
    dataType,
    typeName,
    blockType,
    blockKind,
    assemblyName: text(typeEl, "AssemblyName") || undefined,
    required: text(pd, "Required") === "true",
    languageSpecific: text(pd, "LanguageSpecific") === "true",
    editCaption: text(pd, "EditCaption"),
    valueKind,
    createsDependency: DEPENDENCY_KINDS.has(valueKind),
    helpText: optionalText(pd, "HelpText"),
    displayEditUI: optionalBool(pd, "DisplayEditUI"),
    existsOnModel: optionalBool(pd, "ExistsOnModel"),
    hidden: optionalBool(typeEl, "Hidden"),
    tab,
    fieldOrder: optionalNum(pd, "FieldOrder"),
    searchable: optionalBool(pd, "Searchable"),
    defaultValueType: optionalText(pd, "DefaultValueType"),
    editorHint: optionalText(pd, "EditorHint"),
    saved: optionalText(pd, "Saved"),
  };
}

const PAGE_TREE_AVAILABILITY_NOTE =
  "Page-tree child availability from <availablecontenttypes>; not ContentArea [AllowedTypes].";

function readChildAvailability(docRoot: XElement, types: Record<string, ContentTypeInfo>): ChildAvailabilityInfo[] | undefined {
  const available = firstChild(docRoot, "availablecontenttypes");
  if (!available) return undefined;
  const array = firstChild(available, "ArrayOfAllowedContentTypeDTO");
  if (!array) return undefined;
  const entries: ChildAvailabilityInfo[] = [];
  for (const dto of childElements(array)) {
    if (dto.name !== "AllowedContentTypeDTO") continue;
    const ownerContentTypeName = optionalText(dto, "ContentTypeName");
    const ownerContentTypeId = optionalNum(dto, "ContentTypeID") ?? optionalNum(dto, "ContentTypeId") ?? (ownerContentTypeName ? types[ownerContentTypeName]?.id : undefined);
    const related = firstChild(dto, "RelatedContentTypeNames");
    entries.push({
      ownerContentTypeName,
      ownerContentTypeId,
      availability: optionalText(dto, "Availability"),
      allowedTypeNames: related ? childElements(related).filter((el) => el.name === "string").map((el) => decodeSchemaText(rawText(el))).filter((v) => v.trim().length > 0) : [],
      note: PAGE_TREE_AVAILABILITY_NOTE,
    });
  }
  return entries;
}

function summarizeCapabilities(types: Record<string, ContentTypeInfo>, childAvailability: ChildAvailabilityInfo[] | undefined): ExportCapabilitySummary {
  const properties = Object.values(types).flatMap((t) => t.properties);
  const pageTreeAvailabilityByStatus: Record<string, number> = {};
  for (const entry of childAvailability ?? []) {
    if (entry.availability === undefined) continue;
    pageTreeAvailabilityByStatus[entry.availability] = (pageTreeAvailabilityByStatus[entry.availability] ?? 0) + 1;
  }
  return {
    helpTextProperties: properties.filter((p) => p.helpText !== undefined).length,
    displayEditUIFalseProperties: properties.filter((p) => p.displayEditUI === false).length,
    existsOnModelFalseProperties: properties.filter((p) => p.existsOnModel === false).length,
    pageTreeAvailabilityEntries: childAvailability?.length ?? 0,
    pageTreeAvailabilityByStatus,
    absentMetadata: ["enum labels/values", "ContentArea [AllowedTypes]", "[ScaffoldColumn]"],
  };
}

export function parseSchema(packagePath: string): SchemaIndex {
  let parts: ReturnType<typeof readPackage>;
  try {
    parts = readPackage(packagePath);
  } catch {
    throw new Error(`parseSchema: failed to read "${packagePath}" as an .episerverdata ZIP export`);
  }
  const epiDefinition = parts.get("epiDefinition.xml");
  if (!epiDefinition) throw new Error("parseSchema: missing epiDefinition.xml");
  const doc = parseXml(epiDefinition.toString("utf8"));
  const contentTypes = firstChild(doc.root, "contenttypes");
  if (!contentTypes) throw new Error("parseSchema: missing <contenttypes>");
  const array = firstChild(contentTypes, "ArrayOfContentTypeTransferObject");
  if (!array) throw new Error("parseSchema: missing <ArrayOfContentTypeTransferObject>");

  const types: Record<string, ContentTypeInfo> = {};
  for (const ct of childElements(array)) {
    if (ct.name !== "ContentTypeTransferObject") continue;
    const base = text(ct, "Base");
    const name = text(ct, "Name");
    const propsEl = firstChild(ct, "PropertyDefinitions");
    types[name] = {
      id: requiredNum(ct, "ID", name),
      guid: text(ct, "GUID"),
      name,
      displayName: text(ct, "DisplayName") || name,
      base,
      kind: kindOf(base),
      modelType: text(ct, "ModelTypeString") || undefined,
      properties: propsEl
        ? childElements(propsEl)
            .filter((p) => p.name === "PropertyDefinition")
            .map((p) => readProperty(p))
        : [],
      description: optionalText(ct, "Description"),
      groupName: optionalText(ct, "GroupName"),
      isAvailable: optionalBool(ct, "IsAvailable"),
      sortOrder: optionalNum(ct, "SortOrder"),
      supportedMediaExtensions: optionalText(ct, "SupportedMediaExtensions"),
      versionString: optionalText(ct, "VersionString"),
      saved: optionalText(ct, "Saved"),
      created: optionalText(ct, "Created"),
    };
  }

  const childAvailability = readChildAvailability(doc.root, types);
  if (childAvailability) {
    for (const entry of childAvailability) {
      const owner = entry.ownerContentTypeName ? types[entry.ownerContentTypeName] : Object.values(types).find((t) => t.id === entry.ownerContentTypeId);
      if (owner) (owner.childAvailability ??= []).push(entry);
    }
  }

  return {
    culture: attr(doc.root, "culture") ?? "",
    version: attr(doc.root, "version") ?? "",
    types,
    capabilities: summarizeCapabilities(types, childAvailability),
    childAvailability,
  };
}
