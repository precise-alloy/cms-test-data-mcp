import { join, isAbsolute, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import guide from "./tool-guide.md" with { type: "text" };
import { parseSchema } from "../schema/parse";
import type { SchemaIndex } from "../schema/types";
import { validatePlan, nearest, propertyLimitationNotes, skeletonOmissionReason, isImageCapable } from "../plan/validate";
import type { ContentPlan } from "../plan/types";
import { buildPackageIr } from "../plan/build";
import {
  DEFAULT_IMAGE_HEIGHT,
  DEFAULT_IMAGE_WIDTH,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_PLAN_ITEMS,
} from "../media/png";
import { writeIrToFile } from "../pkg/assemble";
import { readPackage } from "../pkg/read";
import { parseXml } from "../xml/parse";
import { irFromEpix } from "../ir/fromXml";
import { topLevelProperties } from "../ir/inspect";
import type { ValueKind } from "../vocab/types";
import type { ChildAvailabilityInfo, ContentTypeInfo, ExportCapabilitySummary, PropertyInfo } from "../schema/types";
import { DIAGNOSTIC_LOCALE, MAX_BLOCK_DEPTH } from "../values/constants";

export type QuerySchemaArgs = {
  kind?: "page" | "block" | "media" | "other";
  typeNameContains?: string;
  propertyNameContains?: string;
  captionContains?: string;
  helpTextContains?: string;
  editorHint?: string;
  displayEditUI?: boolean;
  existsOnModel?: boolean;
  hidden?: boolean;
  valueKind?: ValueKind;
  savedSince?: string;
  createdSince?: string;
  includeAvailability?: boolean;
  limit?: number;
  responseByteBudget?: number;
};

export type QuerySchemaResult = {
  total: number;
  truncated: boolean;
  limit: number;
  matchReasons: string[];
  capabilities?: ExportCapabilitySummary;
  noteLegend?: Record<string, string>;
  pageTreeChildAvailabilityByType?: Record<string, ChildAvailabilityInfo[]>;
  results: QuerySchemaResultItem[];
};

export type QuerySchemaResultItem = {
  type: { name: string; displayName: string; kind: string };
  property?: {
    name: string;
    caption: string;
    valueKind: ValueKind;
    helpText?: string;
    editorHint?: string;
    displayEditUI?: boolean;
    existsOnModel?: boolean;
    hidden?: boolean;
    saved?: string;
    noteRefs?: string[];
  };
};

function contains(value: string | undefined, needle: string | undefined): boolean {
  return needle === undefined || (value ?? "").toLowerCase().includes(needle.toLowerCase());
}

function parseSince(field: "savedSince" | "createdSince", since: string | undefined): number | undefined {
  if (since === undefined) return undefined;
  const sinceTime = Date.parse(since);
  if (Number.isNaN(sinceTime)) throw new Error(`querySchema: ${field} must be a parseable timestamp`);
  return sinceTime;
}

function onOrAfter(value: string | undefined, sinceTime: number | undefined): boolean {
  if (sinceTime === undefined) return true;
  if (value === undefined) return false;
  const valueTime = Date.parse(value);
  return !Number.isNaN(valueTime) && valueTime >= sinceTime;
}

function hasPropertyFilters(args: QuerySchemaArgs): boolean {
  return (
    args.propertyNameContains !== undefined ||
    args.captionContains !== undefined ||
    args.helpTextContains !== undefined ||
    args.editorHint !== undefined ||
    args.displayEditUI !== undefined ||
    args.existsOnModel !== undefined ||
    args.hidden !== undefined ||
    args.valueKind !== undefined ||
    args.savedSince !== undefined
  );
}

function compactResultMetadata(result: QuerySchemaResult): QuerySchemaResult {
  if (result.pageTreeChildAvailabilityByType) {
    const resultTypes = new Set(result.results.map((item) => item.type.name));
    result.pageTreeChildAvailabilityByType = Object.fromEntries(
      Object.entries(result.pageTreeChildAvailabilityByType).filter(([name]) => resultTypes.has(name))
    );
    if (Object.keys(result.pageTreeChildAvailabilityByType).length === 0) {
      result.pageTreeChildAvailabilityByType = undefined;
    }
  }
  if (result.noteLegend) {
    const usedNotes = new Set(result.results.flatMap((item) => item.property?.noteRefs ?? []));
    result.noteLegend = Object.fromEntries(
      Object.entries(result.noteLegend).filter(([id]) => usedNotes.has(id))
    );
    if (Object.keys(result.noteLegend).length === 0) {
      result.noteLegend = undefined;
    }
  }
  return result;
}

function fitToByteBudget(result: QuerySchemaResult, byteBudget: number): QuerySchemaResult {
  const trimmed = compactResultMetadata({ ...result, results: [...result.results] });
  const payloadBytes = () => Buffer.byteLength(JSON.stringify(trimmed, null, 2), "utf8");
  if (payloadBytes() <= byteBudget) return trimmed;
  trimmed.truncated = true;
  while (trimmed.results.length > 0 && payloadBytes() > byteBudget) {
    trimmed.results.pop();
    compactResultMetadata(trimmed);
  }
  if (payloadBytes() <= byteBudget) return trimmed;
  trimmed.capabilities = undefined;
  compactResultMetadata(trimmed);
  if (payloadBytes() <= byteBudget) return trimmed;
  if (trimmed.matchReasons.length > 0) {
    trimmed.matchReasons = [`${trimmed.matchReasons.length} filter(s) applied; details omitted to fit responseByteBudget`];
  }
  if (payloadBytes() <= byteBudget) return trimmed;
  throw new Error("querySchema: responseByteBudget is too small to include required metadata for the supplied filters");
}

function summarizeType(type: ContentTypeInfo): QuerySchemaResultItem["type"] {
  return { name: type.name, displayName: type.displayName, kind: type.kind };
}

function summarizeProperty(property: PropertyInfo, noteRef: (note: string) => string): QuerySchemaResultItem["property"] {
  const noteRefs = propertyLimitationNotes(property).map(noteRef);
  return {
    name: property.name,
    caption: property.editCaption,
    valueKind: property.valueKind,
    helpText: property.helpText,
    editorHint: property.editorHint,
    displayEditUI: property.displayEditUI,
    existsOnModel: property.existsOnModel,
    hidden: property.hidden,
    saved: property.saved,
    noteRefs: noteRefs.length ? noteRefs : undefined,
  };
}

function mediaLimitation(schema: SchemaIndex): string {
  const mediaTypes = Object.values(schema.types).filter((type) => type.kind === "media");
  const capable = mediaTypes.filter((t) => isImageCapable(t)).map((t) => t.name).sort();
  const notCapable = mediaTypes.filter((t) => !isImageCapable(t)).map((t) => t.name).sort();
  const capableText = capable.length ? ` Image-capable media types: ${capable.join(", ")}.` : "";
  const notCapableText = notCapable.length ? ` Non-image-capable media types (will be rejected): ${notCapable.join(", ")}.` : "";
  return `Raster image media is generated: each media item produces a placeholder PNG (default 1280×720; set image.width/height to override). SVG, PDF and video media are not generated.${capableText}${notCapableText} ContentArea [AllowedTypes] is absent from the export, so the tool cannot determine which references require media.`;
}

function renderUsageGuide(): string {
  return guide
    .replaceAll("{{MAX_PLAN_ITEMS}}", MAX_PLAN_ITEMS.toLocaleString(DIAGNOSTIC_LOCALE))
    .replaceAll("{{MAX_IMAGE_PIXELS}}", MAX_IMAGE_PIXELS.toLocaleString(DIAGNOSTIC_LOCALE))
    .replaceAll("{{MAX_IMAGE_DIMENSION}}", String(MAX_IMAGE_DIMENSION))
    .replaceAll("{{DEFAULT_IMAGE_WIDTH}}", String(DEFAULT_IMAGE_WIDTH))
    .replaceAll("{{DEFAULT_IMAGE_HEIGHT}}", String(DEFAULT_IMAGE_HEIGHT));
}

function propertyMatchReasons(args: QuerySchemaArgs): string[] {
  const reasons: string[] = [];
  if (args.propertyNameContains !== undefined) reasons.push(`property name contains "${args.propertyNameContains}"`);
  if (args.captionContains !== undefined) reasons.push(`caption contains "${args.captionContains}"`);
  if (args.helpTextContains !== undefined) reasons.push(`help text contains "${args.helpTextContains}"`);
  if (args.editorHint !== undefined) reasons.push(`editor hint is "${args.editorHint}"`);
  if (args.displayEditUI !== undefined) reasons.push(`displayEditUI is ${args.displayEditUI}`);
  if (args.existsOnModel !== undefined) reasons.push(`existsOnModel is ${args.existsOnModel}`);
  if (args.hidden !== undefined) reasons.push(`hidden is ${args.hidden}`);
  if (args.valueKind !== undefined) reasons.push(`valueKind is "${args.valueKind}"`);
  if (args.savedSince !== undefined) reasons.push(`saved on or after ${args.savedSince}`);
  return reasons;
}

function propertyMatches(property: PropertyInfo, args: QuerySchemaArgs, savedSinceTime: number | undefined): boolean {
  return (
    contains(property.name, args.propertyNameContains) &&
    contains(property.editCaption, args.captionContains) &&
    contains(property.helpText, args.helpTextContains) &&
    (args.editorHint === undefined || property.editorHint?.toLowerCase() === args.editorHint.toLowerCase()) &&
    (args.displayEditUI === undefined || property.displayEditUI === args.displayEditUI) &&
    (args.existsOnModel === undefined || property.existsOnModel === args.existsOnModel) &&
    (args.hidden === undefined || property.hidden === args.hidden) &&
    (args.valueKind === undefined || property.valueKind === args.valueKind) &&
    onOrAfter(property.saved, savedSinceTime)
  );
}

function placeholderFor(p: PropertyInfo, schema: SchemaIndex, depth: number): unknown {
  if (p.valueKind === "block") {
    const bt = p.blockType ? schema.types[p.blockType.name] : undefined;
    const shape =
      bt && depth < MAX_BLOCK_DEPTH
        ? Object.fromEntries(
            bt.properties
              .filter((c) => !skeletonOmissionReason(c))
              // A block child at the cap cannot be supplied — checkPropertyValue rejects
              // any block at depth >= MAX_BLOCK_DEPTH — so omit it rather than emit a value
              // the plan cannot use.
              .filter((c) => !(c.valueKind === "block" && depth + 1 >= MAX_BLOCK_DEPTH))
              .map((c) => [c.name, placeholderFor(c, schema, depth + 1)])
          )
        : {};
    return p.blockKind === "List" ? [shape] : shape;
  }
  return p.valueKind === "contentArea" ? [{ ref: "<key>" }]
    : p.valueKind === "contentRef" ? { ref: "<key>" }
    : p.valueKind === "contentRefList" ? [{ ref: "<key>" }]
    : p.valueKind === "linkCollection" ? [{ text: "<text>", href: "https://example.com" }]
    : p.valueKind === "bool" ? false
    : p.valueKind === "int" || p.valueKind === "float" ? 0
    : p.valueKind === "date" ? "2026-01-01T00:00:00Z"
    : p.valueKind === "html" ? "<p>...</p>"
    : "...";
}

/** Required properties the skeleton cannot supply, as dotted paths. Mirrors placeholderFor's traversal and bounds so the two cannot disagree. */
function unsatisfiableRequired(
  props: PropertyInfo[],
  schema: SchemaIndex,
  depth: number,
  prefix: string
): string[] {
  const out: string[] = [];
  for (const p of props) {
    const path = prefix ? `${prefix}.${p.name}` : p.name;
    const droppedAtCap = p.valueKind === "block" && depth >= MAX_BLOCK_DEPTH;
    if (skeletonOmissionReason(p) || droppedAtCap) {
      if (p.required) out.push(path);
      continue;
    }
    if (p.valueKind === "block" && p.blockType) {
      const bt = schema.types[p.blockType.name];
      if (bt) out.push(...unsatisfiableRequired(bt.properties, schema, depth + 1, path));
    }
  }
  return out;
}

export function createToolset(cwd: string) {
  let schema: SchemaIndex | null = null;

  const resolve = (p: string) => (isAbsolute(p) ? p : join(cwd, p));
  const need = () => {
    if (!schema) throw new Error("Schema not loaded. Call load_schema first.");
    return schema;
  };

  return {
    async usageGuide(): Promise<string> {
      return renderUsageGuide();
    },

    async loadSchema({ path }: { path: string }) {
      schema = parseSchema(resolve(path));
      const properties = Object.values(schema.types).flatMap((t) => t.properties);
      return {
        contentTypes: Object.keys(schema.types).length,
        properties: properties.length,
        mediaContentTypes: Object.values(schema.types).filter((type) => type.kind === "media").map((type) => type.name).sort(),
        mediaLimitation: mediaLimitation(schema),
        usageGuide: "Call usage_guide before writing your first plan for this schema.",
        unprovenProperties: properties.filter((p) => p.valueKind === "unproven").length,
        helpTextProperties: schema.capabilities?.helpTextProperties ?? 0,
        displayEditUIFalseProperties: schema.capabilities?.displayEditUIFalseProperties ?? 0,
        existsOnModelFalseProperties: schema.capabilities?.existsOnModelFalseProperties ?? 0,
        pageTreeAvailabilityEntries: schema.capabilities?.pageTreeAvailabilityEntries ?? 0,
        pageTreeAvailabilityByStatus: schema.capabilities?.pageTreeAvailabilityByStatus ?? {},
        capabilities: schema.capabilities,
      };
    },

    async listContentTypes({ kind, nameContains, limit = 50 }: { kind?: string; nameContains?: string; limit?: number }) {
      const all = Object.values(need().types)
        .filter((t) => (kind ? t.kind === kind : true))
        .filter((t) => (nameContains ? t.name.toLowerCase().includes(nameContains.toLowerCase()) : true));
      const slice = all.slice(0, limit);
      return {
        total: all.length,
        truncated: all.length > limit,
        types: slice.map((t) => ({
          name: t.name,
          displayName: t.displayName,
          base: t.base,
          kind: t.kind,
          propertyCount: t.properties.length,
        })),
      };
    },

    async querySchema(args: QuerySchemaArgs): Promise<QuerySchemaResult> {
      const loaded = need();
      const limit = Math.min(Math.max(0, args.limit ?? 50), 100);
      const savedSinceTime = parseSince("savedSince", args.savedSince);
      const createdSinceTime = parseSince("createdSince", args.createdSince);
      const noteIds = new Map<string, string>();
      const noteRef = (note: string): string => {
        const existing = noteIds.get(note);
        if (existing) return existing;
        const id = `n${noteIds.size + 1}`;
        noteIds.set(note, id);
        return id;
      };
      const typeFiltered = Object.values(loaded.types)
        .filter((t) => (args.kind ? t.kind === args.kind : true))
        .filter((t) => (args.typeNameContains ? contains(t.name, args.typeNameContains) || contains(t.displayName, args.typeNameContains) : true))
        .filter((t) => onOrAfter(t.created, createdSinceTime));
      const propertyFiltered = hasPropertyFilters(args);
      const all: QuerySchemaResultItem[] = [];
      const matchReasons: string[] = [];
      if (args.kind) matchReasons.push(`kind is "${args.kind}"`);
      if (args.typeNameContains) matchReasons.push(`type name contains "${args.typeNameContains}"`);
      if (args.createdSince) matchReasons.push(`content type created on or after ${args.createdSince}`);
      matchReasons.push(...propertyMatchReasons(args));

      for (const type of typeFiltered) {
        if (!propertyFiltered) {
          all.push({
            type: summarizeType(type),
          });
          continue;
        }

        for (const property of type.properties.filter((p) => propertyMatches(p, args, savedSinceTime))) {
          all.push({
            type: summarizeType(type),
            property: summarizeProperty(property, noteRef),
          });
        }
      }

      const results = all.slice(0, limit);
      const pageTreeChildAvailabilityByType = args.includeAvailability
        ? Object.fromEntries(
            [...new Set(results.map((item) => item.type.name))]
              .map((name) => [name, loaded.types[name]?.childAvailability])
              .filter((entry): entry is [string, ChildAvailabilityInfo[]] => entry[1] !== undefined && entry[1].length > 0)
          )
        : undefined;
      const noteLegend = noteIds.size
        ? Object.fromEntries([...noteIds.entries()].map(([note, id]) => [id, note]))
        : undefined;
      const response = {
        total: all.length,
        truncated: all.length > limit,
        limit,
        matchReasons,
        capabilities: loaded.capabilities,
        noteLegend,
        pageTreeChildAvailabilityByType,
        results,
      };
      return fitToByteBudget(response, args.responseByteBudget ?? 48000);
    },

    async describeContentType({ name }: { name: string }) {
      const loaded = need();
      const type = loaded.types[name];
      if (!type) {
        const names = Object.keys(loaded.types);
        const hint = nearest(name, names);
        return { error: `type "${name}" does not exist.${hint ? ` Did you mean "${hint}"?` : ""}` };
      }
      const properties = type.properties.map((p) => ({
        name: p.name,
        caption: p.editCaption,
        valueKind: p.valueKind,
        required: p.required,
        createsDependency: p.createsDependency,
        helpText: p.helpText,
        editorHint: p.editorHint,
        displayEditUI: p.displayEditUI,
        existsOnModel: p.existsOnModel,
        hidden: p.hidden,
        notes: propertyLimitationNotes(p),
        skeletonOmitted: skeletonOmissionReason(p) !== undefined ? true : undefined,
        skeletonOmissionReason: skeletonOmissionReason(p),
      }));
      const skeletonProps: Record<string, unknown> = {};
      for (const p of type.properties) {
        if (skeletonOmissionReason(p)) continue;
        skeletonProps[p.name] = placeholderFor(p, need(), 0);
      }
      return {
        name: type.name,
        kind: type.kind,
        properties,
        limitations: [
          mediaLimitation(loaded),
          ...(type.properties.some((p) => p.valueKind === "unproven") ? ["Unproven property types are left empty because the export lacks round-trip serialization evidence."] : []),
          ...(type.properties.some((p) => p.valueKind === "block") ? ["Inline block properties take an object or array depending on their Kind; the skeleton shows which — an object for a Value block, an array for a List block."] : []),
          ...(type.properties.some((p) => p.valueKind === "int") ? ["Integer properties may be selection/enum fields; confirm legal values in CMS edit mode because the export carries no label mapping."] : []),
          ...(type.properties.some((p) => skeletonOmissionReason(p)) ? ["Skeleton omits only properties with unsupported serialization; each omitted property carries skeletonOmissionReason."] : []),
          ...(() => {
            const missing = unsatisfiableRequired(type.properties, need(), 0, "");
            return missing.length
              ? [`These properties are required but cannot be supplied, so validate_plan will report them missing: ${missing.join(", ")}. Their serialization is unproven or they sit past the nesting cap; the CMS import still needs them set by hand.`]
              : [];
          })(),
        ],
        skeleton: {
          planId: "<plan-id>",
          items: [{ key: "item-1", type: type.name, name: "<display name>", properties: skeletonProps }],
        },
      };
    },

    async validatePlanTool({ plan }: { plan: ContentPlan }) {
      const diags = validatePlan(plan, need());
      return {
        errors: diags.filter((d) => d.level === "error"),
        warnings: diags.filter((d) => d.level === "warning"),
      };
    },

    async buildPackage({ plan, outputPath }: { plan: ContentPlan; outputPath: string }) {
      const diags = validatePlan(plan, need());
      const errors = diags.filter((d) => d.level === "error");
      if (errors.length) {
        return { written: false, errors, warnings: diags.filter((d) => d.level === "warning") };
      }
      const { ir, warnings, blobs } = buildPackageIr(plan, need(), new Date());
      // Collect GUIDs before touching the filesystem so a missing-GUID error surfaces cleanly.
      const allItems = [...ir.selected, ...ir.closure];
      const guids: string[] = [];
      for (const item of allItems) {
        const prop = topLevelProperties(item).find((p) => p.name === "PageGUID");
        const pageNameProp = topLevelProperties(item).find((p) => p.name === "PageName");
        if (!prop?.value) {
          return {
            written: false,
            errors: [{ level: "error", message: `item "${pageNameProp?.value ?? "(unknown)"}" is missing PageGUID` }],
            warnings,
          };
        }
        guids.push(prop.value);
      }
      const out = resolve(outputPath);
      mkdirSync(dirname(out), { recursive: true });
      writeIrToFile(ir, guids, blobs, out);
      return {
        written: true,
        path: out,
        itemCount: guids.length,
        errors: [],
        warnings: [...diags.filter((d) => d.level === "warning"), ...warnings],
      };
    },

    async inspectPackage({ path }: { path: string }) {
      const parts = readPackage(resolve(path));
      const ir = irFromEpix(parseXml(parts.get("epix.xml")!.toString("utf8")));
      const summarize = (item: (typeof ir.selected)[number]) => {
        const props = topLevelProperties(item);
        const get = (n: string) => props.find((p) => p.name === n)?.value;
        return { name: get("PageName"), type: get("PageTypeName"), guid: get("PageGUID") };
      };
      const closureSlice = ir.closure.slice(0, 50);
      return {
        itemCount: ir.selected.length + ir.closure.length,
        selected: ir.selected.map(summarize),
        closureTotal: ir.closure.length,
        truncated: ir.closure.length > 50,
        closure: closureSlice.map(summarize),
        entries: [...parts.keys()],
      };
    },
  };
}

export type Toolset = ReturnType<typeof createToolset>;
