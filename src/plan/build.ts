import { createHash } from "node:crypto";
import type { XElement, XNode } from "../xml/types";
import { element, textNode } from "../xml/query";
import type { PackageIR } from "../ir/types";
import type { ContentTypeInfo, PropertyInfo, SchemaIndex } from "../schema/types";
import { serializeValue, formatDate, guidNoDashes, escapeXml, bracketRef, type RefResolver } from "../values/serialize";
import {
  EMPTY_GUID,
  DIAGNOSTIC_LOCALE,
  EXPORT_CULTURE,
  EXPORT_VERSION,
  SYSTEM_ROOTS,
  WORK_STATUS_PUBLISHED,
  MAX_BLOCK_DEPTH,
} from "../values/constants";
import { expandTemplates, skeletonOmissionReason, slugify, isImageCapable, type ContentPlan, type Diagnostic, type PlanItem } from "./validate";
import { generatePng, DEFAULT_IMAGE_WIDTH, DEFAULT_IMAGE_HEIGHT, MAX_IMAGE_PIXELS, MAX_PLAN_ITEMS } from "../media/png";
import { makeMediaBlob, type MediaBlob } from "../media/blob";

const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 DNS namespace
const FOLDER_TYPE_GUID = "52f8d1e9-6d87-4db6-a465-41890289fb78"; // SysContentFolder
const FOLDER_TYPE_NAME = "SysContentFolder";

/** Deterministic UUIDv5 so re-running a plan updates rather than duplicates content. */
export function planGuid(planId: string, key: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  // Length-prefix each part to prevent collision across slash-split boundaries.
  // e.g. planGuid("p","a/b") must not equal planGuid("p/a","b").
  const input = `${planId.length}:${planId}:${key.length}:${key}`;
  const hash = createHash("sha1").update(ns).update(input, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const XMLNS = [
  { name: "xmlns:xsi", rawValue: "http://www.w3.org/2001/XMLSchema-instance" },
  { name: "xmlns:xsd", rawValue: "http://www.w3.org/2001/XMLSchema" },
];

function ace(name: string, access: string): XElement {
  return element("RawACE", [
    element("Name", [textNode(name)]),
    element("EntityType", [textNode("Role")]),
    element("Access", [textNode(access)]),
  ]);
}

/** Default ACL copied from the fixtures; role names are site-specific. */
export const DEFAULT_ACL: XElement = element("ACL", [
  ace("Authenticated", "Read"),
  ace("CmsAdmins", "FullAccess"),
  ace("CmsEditors", "Read Create Edit Delete Publish"),
  ace("Everyone", "Read"),
]);

export type RawPropOpts = {
  definitionId?: number;
  ownerTab?: number;
  isNull?: boolean;
  isRequired?: boolean;
  isPropertyData?: boolean;
  languageSpecific?: boolean;
  type: string;
  name: string;
  typeName?: string;
  assemblyName?: string;
  value?: string;
  listCount?: number;
  customData?: XElement;
  /** Shape 4: EPi:SystemReference omits CustomData entirely. */
  omitCustomData?: boolean;
  isModified?: boolean;
  /** Shape 3: a populated inline block omits Value and carries a BlockTypeReference. */
  blockTypeRef?: { guid: string; name: string; modelTypeString: string };
  blockChildren?: XElement[];
  /** Real RawProperty entries for a list-kind block, as opposed to the xsi:nil
   *  placeholders `listCount` writes for a contentArea. */
  blockListEntries?: XElement[];
};

export function rawProperty(o: RawPropOpts): XElement {
  const kids: XNode[] = [
    element("PropertyDefinitionID", [textNode(String(o.definitionId ?? 0))]),
    element("OwnerTab", [textNode(String(o.ownerTab ?? -1))]),
    element("IsModified", [textNode(o.isModified ? "true" : "false")]),
    element("IsNull", [textNode(o.isNull ? "true" : "false")]),
    element("IsRequired", [textNode(o.isRequired ? "true" : "false")]),
    element("IsPropertyData", [textNode(o.isPropertyData ? "true" : "false")]),
    element("IsDynamicProperty", [textNode("false")]),
    element("IsLanguageSpecific", [textNode(o.languageSpecific ? "true" : "false")]),
    element("Type", [textNode(escapeXml(o.type))]),
    element("Name", [textNode(escapeXml(o.name))]),
  ];
  if (o.typeName) {
    kids.push(element("TypeName", [textNode(escapeXml(o.typeName))]));
    kids.push(element("AssemblyName", [textNode(escapeXml(o.assemblyName ?? "EPiServer"))]));
  }
  if (o.blockTypeRef) {
    // A populated block omits Value entirely; that absence is what distinguishes it
    // from an unset block, which writes an empty Value and no BlockTypeReference.
    kids.push(
      element("BlockTypeReference", [
        element("GUID", [textNode(escapeXml(o.blockTypeRef.guid))]),
        element("Name", [textNode(escapeXml(o.blockTypeRef.name))]),
        element("ModelTypeString", [textNode(escapeXml(o.blockTypeRef.modelTypeString))]),
      ])
    );
  } else if (!o.blockListEntries) {
    kids.push(o.value ? element("Value", [textNode(o.value)]) : element("Value"));
  }
  kids.push(element("BlockProperties", o.blockChildren ?? []));
  kids.push(
    o.blockListEntries
      ? element("ListProperties", o.blockListEntries)
      : o.listCount
        ? element("ListProperties", Array.from({ length: o.listCount }, () => ({
            kind: "element" as const,
            name: "RawProperty",
            attrs: [{ name: "xsi:nil", rawValue: "true" }],
            selfClosing: true,
            children: [],
          })))
        : element("ListProperties")
  );
  if (!o.omitCustomData) kids.push(o.customData ?? element("CustomData"));
  return element("RawProperty", kids);
}

type ResolvedItem = {
  key: string;
  guid: string;
  name: string;
  type: ContentTypeInfo;
  parentGuid: string;
  /** The anchor name used to classify this item and set its PageParentLink. Never emitted on pages.
   * Measured: EPi:SystemReference overrides the Destination picker in the CMS importer,
   * forcing content to the named root and ignoring where the user chose to import.
   * Pages omit the property so QA controls placement; the block folder keeps it
   * so blocks always land in EPi:GlobalResourcesRoot regardless of Destination. */
  systemReference?: string;
  /** True only for the plan folder. Pages always false. */
  emitSystemReference: boolean;
  urlSegment?: string;
  isPage: boolean;
  isMedia: boolean;
  /** Set only for media items. */
  blob?: MediaBlob;
  visibleInMenu: boolean;
  properties: Record<string, unknown>;
};

/**
 * The system properties page and media share, in export order.
 *
 * PageCreated, PageCreatedBy, PageChangedBy and PageChangedOnPublish are the only
 * shared properties whose flags differ: language-specific on media, not on pages.
 * Measured across 212 media items in real exports, not assumed.
 */
function commonSystemProperties(
  item: ResolvedItem,
  now: Date,
  auditLanguageSpecific: boolean
): XElement[] {
  const stamp = formatDate(now);
  return [
    rawProperty({ type: "String", name: "PageGUID", value: item.guid }),
    rawProperty({ type: "PageReference", name: "PageLink", value: bracketRef(item.guid) }),
    rawProperty({ type: "PageReference", name: "PageParentLink", value: bracketRef(item.parentGuid) }),
    rawProperty({ ownerTab: 0, type: "String", name: "PageName", value: escapeXml(item.name), languageSpecific: true }),
    rawProperty({
      type: "PageType",
      name: "PageTypeID",
      isRequired: true,
      value: escapeXml(item.type.guid),
      customData: element("CustomData", [
        element("RawNameAndXml", [
          element("Name", [textNode("PageTypeName")]),
          element("Xml", [textNode(escapeXml(`<string>${escapeXml(item.type.name)}</string>`))]),
        ]),
      ]),
    }),
    rawProperty({ type: "String", name: "PageTypeName", value: escapeXml(item.type.name) }),
    rawProperty({ type: "Date", name: "PageSaved", value: stamp, languageSpecific: true }),
    rawProperty({ type: "Date", name: "PageChanged", value: stamp, languageSpecific: true }),
    rawProperty({ type: "Date", name: "PageCreated", value: stamp, languageSpecific: auditLanguageSpecific }),
    rawProperty({ type: "String", name: "PageCreatedBy", isNull: true, languageSpecific: auditLanguageSpecific }),
    rawProperty({ type: "String", name: "PageChangedBy", isNull: true, languageSpecific: auditLanguageSpecific }),
    rawProperty({ type: "Boolean", name: "PageChangedOnPublish", value: "False", languageSpecific: auditLanguageSpecific }),
    rawProperty({ type: "Boolean", name: "PageDeleted", value: "False" }),
    rawProperty({ type: "String", name: "PageDeletedBy", isNull: true }),
    rawProperty({ type: "Date", name: "PageDeletedDate", isNull: true }),
    rawProperty({
      type: "Number",
      name: "PageWorkStatus",
      typeName: "EPiServer.SpecializedProperties.PropertyVersionStatus",
      value: WORK_STATUS_PUBLISHED,
      languageSpecific: true,
    }),
    rawProperty({ type: "Boolean", name: "PagePendingPublish", value: "False", languageSpecific: true }),
    rawProperty({ type: "Date", name: "PageStartPublish", value: stamp, languageSpecific: true }),
    rawProperty({ type: "Date", name: "PageStopPublish", isNull: true, languageSpecific: true }),
    rawProperty({ type: "Category", name: "PageCategory", isNull: true, languageSpecific: true }),
  ];
}

function systemProperties(item: ResolvedItem, language: string, now: Date): XElement[] {
  const props: XElement[] = [
    // Pages are not language-specific in the four audit fields.
    ...commonSystemProperties(item, now, false),
    rawProperty({
      type: "String",
      name: "PageMasterLanguageBranch",
      typeName: "EPiServer.SpecializedProperties.PropertyLanguage",
      value: escapeXml(language),
    }),
    rawProperty({
      type: "String",
      name: "PageLanguageBranch",
      typeName: "EPiServer.SpecializedProperties.PropertyLanguage",
      value: escapeXml(language),
      languageSpecific: true,
    }),
    rawProperty({ type: "String", name: "PageContentAssetsID", value: EMPTY_GUID, languageSpecific: true }),
    rawProperty({ type: "Boolean", name: "PageVisibleInMenu", value: item.visibleInMenu ? "True" : "False", languageSpecific: true }),
  ];

  // The two trailing if-blocks are unchanged. Do not edit them.
  if (item.urlSegment) {
    props.push(rawProperty({ type: "String", name: "PageURLSegment", value: escapeXml(item.urlSegment), languageSpecific: true }));
  }
  if (item.emitSystemReference && item.systemReference) {
    props.push(
      rawProperty({
        ownerTab: 0,
        type: "Boolean",
        name: "EPi:SystemReference",
        value: item.systemReference,
        omitCustomData: true,
      })
    );
  }
  return props;
}

/**
 * Media omits PageMasterLanguageBranch, PageLanguageBranch, PageContentAssetsID and
 * PageVisibleInMenu — measured across 212 media items in real exports, none of which
 * carry any of the four — and adds the two blob properties.
 *
 * Thumbnail is deliberately null. ImageData.Thumbnail carries
 * [ImageDescriptor(48, 48, Pregenerated = true)], and BlobPartialRouter generates it
 * from BinaryData when the blob is null. Writing a placeholder would make the property
 * non-null and suppress that path permanently.
 */
function mediaSystemProperties(item: ResolvedItem, now: Date): XElement[] {
  const blobProperty = (name: string, value?: string): XElement =>
    rawProperty({
      type: "String",
      name,
      typeName: "EPiServer.SpecializedProperties.PropertyBlob",
      assemblyName: "EPiServer",
      languageSpecific: true,
      isNull: value === undefined,
      value,
    });

  return [
    ...commonSystemProperties(item, now, true),
    rawProperty({ type: "String", name: "PageURLSegment", value: escapeXml(item.urlSegment!), languageSpecific: true }),
    blobProperty("BinaryData", item.blob!.url),
    blobProperty("Thumbnail"),
    rawProperty({
      ownerTab: 0,
      type: "Boolean",
      name: "EPi:SystemReference",
      value: SYSTEM_ROOTS.globalResources.reference,
      omitCustomData: true,
    }),
  ];
}

/** Nested blocks recurse through this same function, so a block child is serialized by
 *  exactly the rules a top-level property gets. `base` already takes definitionId,
 *  ownerTab and languageSpecific from each property's own PropertyInfo, so a nested
 *  child gets its own values rather than inheriting the parent's. */
type PropertyCtx = {
  keyPath: string;
  resolve: RefResolver;
  warnings: Diagnostic[];
  schema: SchemaIndex;
  depth: number;
};

function contentProperties(
  properties: PropertyInfo[],
  values: Record<string, unknown>,
  ctx: PropertyCtx
): XElement[] {
  return properties.map((info: PropertyInfo) => {
    const supplied = values[info.name];
    const base = {
      definitionId: info.id,
      ownerTab: info.tabId,
      isPropertyData: true,
      isRequired: info.required,
      languageSpecific: info.languageSpecific,
      type: info.dataType,
      name: info.name,
      typeName: info.typeName,
      assemblyName: info.assemblyName,
    };

    if (supplied !== undefined && info.valueKind === "block") {
      if (ctx.depth >= MAX_BLOCK_DEPTH) {
        throw new Error(
          `buildPackageIr: inline block nesting at ${ctx.keyPath}.${info.name} exceeds the maximum depth of ${MAX_BLOCK_DEPTH}`
        );
      }
      if (!info.blockType) {
        // No block type was parsed from the export — treat as unsupported and warn.
        ctx.warnings.push({
          level: "warning",
          path: `${ctx.keyPath}.${info.name}`,
          message: `${info.name} at ${ctx.keyPath}.${info.name}: Block-valued property: inline block serialization is not supported.`,
        });
        return rawProperty({ ...base, isNull: true });
      }
      const blockType = ctx.schema.types[info.blockType.name];
      if (!blockType) {
        throw new Error(
          `buildPackageIr: block type "${info.blockType.name}" for ${ctx.keyPath}.${info.name} is not present in the loaded schema`
        );
      }
      const className = info.blockType.modelTypeString.split(",")[0]!.trim();

      /** The populated-Value shape. A list entry is exactly this, reusing the
       *  container's name and definition id, which is why both kinds share it. */
      const populatedBlock = (childValues: Record<string, unknown>, isModified: boolean) =>
        rawProperty({
          ...base,
          isNull: false,
          isModified,
          typeName: `EPiServer.SpecializedProperties.PropertyBlock\`1[${className}]`,
          assemblyName: "EPiServer",
          blockTypeRef: info.blockType,
          blockChildren: contentProperties(blockType.properties, childValues, {
            ...ctx,
            keyPath: `${ctx.keyPath}.${info.name}`,
            depth: ctx.depth + 1,
          }),
        });

      if (info.blockKind === "List") {
        const entries = (supplied as Record<string, unknown>[]) ?? [];
        // No real export writes an IsNull=false list with zero entries: an empty
        // list is the unset shape.
        if (entries.length === 0) return rawProperty({ ...base, isNull: true });
        return rawProperty({
          ...base,
          isNull: false,
          blockListEntries: entries.map((e) => populatedBlock(e ?? {}, true)),
        });
      }

      return populatedBlock((supplied ?? {}) as Record<string, unknown>, false);
    }

    if (supplied === undefined || info.valueKind === "unproven" || info.valueKind === "block") {
      if (supplied !== undefined && info.valueKind === "unproven") {
        const reason = skeletonOmissionReason(info) ?? "Unproven property type: no round-trip evidence — will be left empty.";
        ctx.warnings.push({
          level: "warning",
          path: `${ctx.keyPath}.${info.name}`,
          message: `${info.name} at ${ctx.keyPath}.${info.name}: ${reason}`,
        });
      }
      return rawProperty({ ...base, isNull: true });
    }

    const out = serializeValue(info.valueKind, supplied, ctx.resolve);
    return rawProperty({ ...base, value: out.value, listCount: out.listCount });
  });
}

function transferContentData(item: ResolvedItem, language: string, now: Date, resolve: RefResolver, warnings: Diagnostic[], schema: SchemaIndex): XElement {
  const system = item.isMedia
    ? mediaSystemProperties(item, now)
    : systemProperties(item, language, now);
  const ctx = { keyPath: item.key, resolve, warnings, schema, depth: 0 };
  const props = [...system, ...contentProperties(item.type.properties, item.properties, ctx)];
  const contentData = element("RawContentData", [DEFAULT_ACL, element("Property", props)]);

  const children: XNode[] = [contentData];
  // Media never carries a language data block: 0 of 212 real media items have one.
  if (item.isPage) {
    const langProps = [
      ...systemProperties(item, language, now),
      ...contentProperties(item.type.properties, item.properties, { ...ctx, warnings: [] }),
    ];
    children.push(element("RawLanguageData", [element("RawContent", [DEFAULT_ACL, element("Property", langProps)])]));
  }

  return { kind: "element", name: "TransferContentData", attrs: XMLNS, selfClosing: false, children };
}

/** Mirrors the body of epiMedia.xml. Order is not significant to the importer. */
function filesElement(blobs: MediaBlob[]): XElement {
  if (blobs.length === 0) return element("files");
  return element(
    "files",
    blobs.map((blob) => ({
      kind: "element" as const,
      name: "BinaryStorableTransferObject",
      attrs: XMLNS,
      selfClosing: false,
      children: [
        element("Url", [textNode(escapeXml(blob.url))]),
        element("PermanentLinkVirtualPath", [textNode(escapeXml(blob.permanentLinkVirtualPath))]),
        element("ProviderName", [textNode(escapeXml(blob.providerName))]),
        element("ProviderRelativePath", [textNode(escapeXml(blob.providerRelativePath))]),
      ],
    }))
  );
}

export function buildPackageIr(
  planInput: ContentPlan,
  schema: SchemaIndex,
  now: Date
): { ir: PackageIR; warnings: Diagnostic[]; blobs: MediaBlob[] } {
  const declaredItems = planInput.items.reduce((total, item) => total + (item.count ?? 1), 0);
  if (declaredItems > MAX_PLAN_ITEMS) {
    throw new Error(
      `buildPackageIr: plan expands to ${declaredItems.toLocaleString(DIAGNOSTIC_LOCALE)} items, but the limit is ${MAX_PLAN_ITEMS.toLocaleString(DIAGNOSTIC_LOCALE)}`
    );
  }

  const plan = expandTemplates(planInput, now);
  const language = plan.language ?? "en";
  const warnings: Diagnostic[] = [];

  const folderKey = `__plan_folder__`;
  const folderGuid = planGuid(plan.planId, folderKey);
  const folderName = `Test data — ${plan.planId}`;

  const resolved: ResolvedItem[] = plan.items.map((item: PlanItem) => {
    const type = schema.types[item.type]!;
    const isPage = type.kind === "page";
    if (item.published === false) {
      warnings.push({
        level: "warning",
        path: item.key!,
        message: `${item.key}: unpublished items are not supported in v1 — will be imported as published`,
      });
    }
    const isMedia = type.kind === "media";
    const mediaSegment = () => {
      const base = slugify(item.name.replace(/\.[a-z0-9]+$/i, "")) || "image";
      return `${base}.png`;
    };
    return {
      key: item.key!,
      guid: planGuid(plan.planId, item.key!),
      name: item.name,
      type,
      parentGuid: "", // filled below
      urlSegment: isMedia
        ? item.urlSegment ?? mediaSegment()
        : isPage
          ? item.urlSegment ?? slugify(item.name)
          : undefined,
      isPage,
      isMedia,
      emitSystemReference: false, // pages never emit; set on folder only
      visibleInMenu: item.visibleInMenu ?? true,
      properties: item.properties ?? {},
    };
  });

  const byKey = new Map(resolved.map((r) => [r.key, r]));
  const planItemByKey = new Map(plan.items.map((i) => [i.key!, i]));

  for (const item of resolved) {
    const declared = planItemByKey.get(item.key)!.parent;
    if (!item.isPage) {
      item.parentGuid = item.isMedia ? SYSTEM_ROOTS.globalResources.guid : folderGuid;
    } else if (!declared || declared === "@root") {
      item.parentGuid = SYSTEM_ROOTS.rootPage.guid;
      item.systemReference = SYSTEM_ROOTS.rootPage.reference;
      // emitSystemReference stays false — see ResolvedItem comment
    } else {
      const parentItem = byKey.get(declared);
      if (!parentItem) throw new Error(`buildPackageIr: unresolved parent key "${declared}" for item "${item.key}"`);
      item.parentGuid = parentItem.guid;
    }
  }

  const resolve: RefResolver = (key) => {
    const target = byKey.get(key);
    if (!target) throw new Error(`buildPackageIr: unresolved ref "${key}"`);
    return { guid: target.guid, name: target.name };
  };

  const folderType: ContentTypeInfo = {
    id: 3,
    guid: FOLDER_TYPE_GUID,
    name: FOLDER_TYPE_NAME,
    displayName: FOLDER_TYPE_NAME,
    base: "Folder",
    kind: "other",
    properties: [],
  };

  const folderItem: ResolvedItem = {
    key: folderKey,
    guid: folderGuid,
    name: folderName,
    type: folderType,
    parentGuid: SYSTEM_ROOTS.globalResources.guid,
    systemReference: SYSTEM_ROOTS.globalResources.reference,
    emitSystemReference: true, // folder keeps it so blocks always land in shared resources
    isPage: false,
    isMedia: false,
    visibleInMenu: true,
    properties: {},
  };

  const toXml = (r: ResolvedItem) => transferContentData(r, language, now, resolve, warnings, schema);
  const rootItems = resolved.filter((r) => r.isPage && r.systemReference === SYSTEM_ROOTS.rootPage.reference);
  const rest = resolved.filter((r) => !rootItems.includes(r));
  const needsFolder = resolved.some((r) => !r.isPage && !r.isMedia);

  const blobs: MediaBlob[] = [];

  // Defensive pre-check: verify all media items are image-capable and the total pixel budget
  // is not exceeded before rendering any PNG. This loop is intentionally separate from the
  // render loop so the throw fires before any compute-intensive work begins.
  let totalBuildPixels = 0;
  for (const item of resolved) {
    if (!item.isMedia) continue;
    if (!isImageCapable(item.type)) {
      throw new Error(
        `buildPackageIr: ${item.type.name} (base "${item.type.base}") cannot hold a placeholder PNG — validatePlan must reject this type before building`
      );
    }
    const planItem = planItemByKey.get(item.key)!;
    const w = planItem.image?.width ?? planItem.image?.height ?? DEFAULT_IMAGE_WIDTH;
    const h = planItem.image?.height ?? planItem.image?.width ?? DEFAULT_IMAGE_HEIGHT;
    totalBuildPixels += w * h;
  }
  if (totalBuildPixels > MAX_IMAGE_PIXELS) {
    throw new Error(
      `buildPackageIr: total image pixel budget exceeded — plan requests more than ${MAX_IMAGE_PIXELS.toLocaleString(DIAGNOSTIC_LOCALE)} pixels across all media items`
    );
  }

  for (const item of resolved) {
    if (!item.isMedia) continue;
    const planItem = planItemByKey.get(item.key)!;
    // One supplied dimension means a square; none means the default.
    const width = planItem.image?.width ?? planItem.image?.height ?? DEFAULT_IMAGE_WIDTH;
    const height = planItem.image?.height ?? planItem.image?.width ?? DEFAULT_IMAGE_HEIGHT;
    // A second deterministic GUID from the same plan, so the blob filename is stable
    // across runs and a re-import overwrites rather than orphaning files.
    const blobGuid = planGuid(plan.planId, `${item.key}#blob`);
    item.blob = makeMediaBlob(item.guid, blobGuid, "png", generatePng(width, height, item.key));
    blobs.push(item.blob);
  }

  const ir: PackageIR = {
    culture: EXPORT_CULTURE,
    version: EXPORT_VERSION,
    contentRoots: element("contentroots", [
      { kind: "element", name: "ArrayOfString", attrs: XMLNS, selfClosing: false,
        children: [element("string", [textNode("RootPage")])] },
    ]),
    selected: rootItems.map(toXml),
    closure: [...(needsFolder ? [toXml(folderItem)] : []), ...rest.map(toXml)],
    files: filesElement(blobs),
  };

  return { ir, warnings, blobs };
}
