import type { ContentTypeInfo, PropertyInfo, SchemaIndex } from "../schema/types";
import { ContentPlanSchema, type ContentPlan, type Diagnostic, type PlanItem } from "./types";
import { DIAGNOSTIC_LOCALE, MAX_BLOCK_DEPTH, RESERVED_URL_SEGMENTS } from "../values/constants";
import { DEFAULT_IMAGE_HEIGHT, DEFAULT_IMAGE_WIDTH, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, MAX_PLAN_ITEMS } from "../media/png";

export * from "./types";

/**
 * Returns true when the CMS type can hold a placeholder PNG.
 *
 * Decision order (mirrors the validate/build guard):
 * 1. supportedMediaExtensions declared and contains "png" (as a token) → capable
 * 2. supportedMediaExtensions declared but does not contain "png" → not capable
 * 3. Not declared, base is "Image" → capable
 * 4. Not declared, base is "Video" → not capable
 * 5. Not declared, any other base → capable (with warning at validate time)
 */
export function isImageCapable(type: ContentTypeInfo): boolean {
  const ext = type.supportedMediaExtensions;
  if (ext !== undefined) {
    return /\bpng\b/i.test(ext);
  }
  return type.base !== "Video";
}

export function propertyLimitationNotes(property: PropertyInfo): string[] {
  const notes: string[] = [];
  if (property.valueKind === "int") {
    notes.push("Integer property. If this is a selection/enum field in the CMS, the export carries no label mapping — confirm the legal values in CMS edit mode before relying on a specific number.");
  }
  if (property.editorHint !== undefined) {
    notes.push(`EditorHint "${property.editorHint}" (from the export; meaning is site-specific).`);
  }
  if (property.hidden === true) notes.push("Hidden property.");
  if (property.displayEditUI === false) notes.push("DisplayEditUI=false: not shown in CMS edit UI.");
  if (property.existsOnModel === false) notes.push("ExistsOnModel=false: exported property is not present on the current content model.");
  if (property.valueKind === "unproven") notes.push("Unproven property type: no round-trip evidence — will be left empty.");
  if (property.valueKind === "block" && !property.blockType) notes.push("Block-valued property: inline block serialization is not supported.");
  return notes;
}

export function skeletonOmissionReason(property: PropertyInfo): string | undefined {
  if (property.valueKind === "unproven") return "Unproven property type: no round-trip evidence — will be left empty.";
  if (property.valueKind === "block" && !property.blockType) return "Block-valued property: inline block serialization is not supported.";
  return undefined;
}

const looksLikeRef = (v: unknown): boolean =>
  typeof v === "string" ||
  (typeof v === "object" && v !== null && typeof (v as { ref?: unknown }).ref === "string");

/**
 * The shape a property of this kind can hold, or undefined when the value fits.
 *
 * Mirrors what serializeValue accepts rather than inventing a stricter contract —
 * "true" really is a valid bool and "5" really is a valid int. The one place it is
 * deliberately stricter is where accepting meant coercing: String(12345) and
 * String({}) used to put "12345" and "[object Object]" into real content fields
 * with no diagnostic at all.
 */
function expectedShape(kind: PropertyInfo["valueKind"], value: unknown): string | undefined {
  switch (kind) {
    case "text":
    case "html":
      return typeof value === "string" ? undefined : "a string";

    case "bool":
      if (typeof value === "boolean") return undefined;
      if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) return undefined;
      return 'a boolean, or the string "true" or "false"';

    case "int":
    case "float":
      if (typeof value === "number" && Number.isFinite(value)) return undefined;
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return undefined;
      return "a number";

    case "date":
      if (value instanceof Date && !Number.isNaN(value.getTime())) return undefined;
      if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return undefined;
      return "a Date, or a string a Date can parse";

    case "contentRef":
      return looksLikeRef(value) ? undefined : 'a reference, {ref: "<key>"}';

    case "contentArea":
    case "contentRefList":
      return Array.isArray(value) ? undefined : 'a list of references, [{ref: "<key>"}]';

    case "linkCollection":
      return Array.isArray(value) ? undefined : "a list of links, [{text, href}]";

    case "url":
      return typeof value === "string" || looksLikeRef(value)
        ? undefined
        : 'a URL string, or {ref: "<key>"}';

    // block, stringList and unproven never reach serializeValue through a plan value.
    default:
      return undefined;
  }
}

const describeValue = (v: unknown): string =>
  v === null ? "null"
  : Array.isArray(v) ? "an array"
  : typeof v === "object" ? "an object"
  : `${typeof v} ${JSON.stringify(v)}`;

type LinkCollectionEntry = { text?: unknown; href?: unknown; ref?: unknown };

function normalizeLinkCollectionEntry(entry: unknown): LinkCollectionEntry {
  return entry && typeof entry === "object" ? entry as LinkCollectionEntry : {};
}

/** Levenshtein distance, used only for "did you mean" suggestions. */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length]![b.length]!;
}

export function nearest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestScore) { bestScore = d; best = c; }
  }
  return bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // NFD does not decompose the Latin letter đ/Đ (Croatian, Serbian, Bosnian,
    // Sami, Vietnamese), so map it explicitly or it would be dropped as punctuation.
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function applyDateTokens(text: string, now: Date): string {
  return text.replace(/\{\{date:([+-]?\d+)([dhm])\}\}/g, (_, amountRaw, unit) => {
    const amount = Number.parseInt(amountRaw, 10);
    const ms = unit === "d" ? 86400000 : unit === "h" ? 3600000 : 60000;
    return new Date(now.getTime() + amount * ms).toUTCString();
  });
}

/** Two passes in fixed order: {{i}} first, then {{date:...}}. */
function substitute(value: unknown, index: number, now: Date): unknown {
  if (typeof value === "string") {
    return applyDateTokens(value.replace(/\{\{i\}\}/g, String(index)), now);
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, index, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v, index, now)])
    );
  }
  return value;
}

export function expandTemplates(plan: ContentPlan, now: Date): ContentPlan {
  const items: PlanItem[] = [];
  let auto = 0;
  for (const item of plan.items) {
    const count = item.count ?? 1;
    for (let i = 1; i <= count; i++) {
      const baseKey = item.key ?? `item-${++auto}`;
      items.push({
        ...item,
        count: undefined,
        key: count > 1 ? `${baseKey}-${i}` : baseKey,
        name: substitute(item.name, i, now) as string,
        urlSegment: item.urlSegment ? (substitute(item.urlSegment, i, now) as string) : undefined,
        properties: item.properties
          ? (substitute(item.properties, i, now) as Record<string, unknown>)
          : undefined,
      });
    }
  }
  return { ...plan, items };
}

/** Checks one property's supplied value. Nested block children run through this same
 *  function, so a child is judged by exactly the rules a top-level property gets. */
function checkPropertyValue(
  info: PropertyInfo,
  value: unknown,
  path: string,
  schema: SchemaIndex,
  diags: Diagnostic[],
  keys: Map<string, number>,
  depth: number
): void {
  if (info.valueKind === "unproven") {
    diags.push({ level: "warning", path, message: `${info.name}: ${skeletonOmissionReason(info)}` });
    return;
  }

  if (info.valueKind === "block") {
    if (!info.blockType) {
      // No block type was parsed from the export — treat as unsupported and warn.
      diags.push({
        level: "warning",
        path,
        message: `${info.name}: Block-valued property: inline block serialization is not supported.`,
      });
      return;
    }
    if (depth >= MAX_BLOCK_DEPTH) {
      diags.push({
        level: "error",
        path,
        message: `inline block nesting at ${path} exceeds the maximum depth of ${MAX_BLOCK_DEPTH}`,
      });
      return;
    }
    const isMap = typeof value === "object" && value !== null && !Array.isArray(value);
    if (info.blockKind === "List") {
      if (!Array.isArray(value)) {
        diags.push({
          level: "error",
          path,
          message: `block property "${info.name}" holds a list, so it expects an array of objects of its block type's properties, got ${describeValue(value)}`,
        });
        return;
      }
      if (info.required && value.length === 0) {
        diags.push({
          level: "error",
          path,
          message: `block property "${info.name}" is required, so its list needs at least one entry — an empty list is written unset`,
        });
        return;
      }
    } else if (!isMap) {
      diags.push({
        level: "error",
        path,
        message: `block property "${info.name}" expects an object of its block type's properties, got ${describeValue(value)}`,
      });
      return;
    }
    const blockType = schema.types[info.blockType.name];
    if (!blockType) {
      diags.push({
        level: "error",
        path,
        message: `block type "${info.blockType.name}" for "${info.name}" is not present in the loaded schema`,
      });
      return;
    }
    const childByName = new Map(blockType.properties.map((p) => [p.name, p]));
    const validateEntry = (entry: unknown, entryPath: string) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        diags.push({
          level: "error",
          path: entryPath,
          message: `each entry of "${info.name}" expects an object of ${blockType.name}'s properties, got ${describeValue(entry)}`,
        });
        return;
      }
      for (const [childName, childValue] of Object.entries(entry as Record<string, unknown>)) {
        const child = childByName.get(childName);
        if (!child) {
          const near = nearest(childName, [...childByName.keys()]);
          diags.push({
            level: "error",
            path: `${entryPath}.${childName}`,
            message: `property "${childName}" does not exist on ${blockType.name}${near ? ` — did you mean "${near}"?` : ""}`,
          });
          continue;
        }
        checkPropertyValue(child, childValue, `${entryPath}.${childName}`, schema, diags, keys, depth + 1);
      }
      for (const child of blockType.properties) {
        if (child.required && (entry as Record<string, unknown>)[child.name] === undefined) {
          diags.push({
            level: "error",
            path: entryPath,
            message: `required property "${child.name}" on ${blockType.name} is missing a value`,
          });
        }
      }
    };
    if (info.blockKind === "List") {
      (value as unknown[]).forEach((entry, i) => validateEntry(entry, `${path}[${i}]`));
    } else {
      validateEntry(value, path);
    }
    return;
  }

  const shape = expectedShape(info.valueKind, value);
  if (shape) {
    diags.push({
      level: "error",
      path,
      message: `${info.valueKind} property "${info.name}" expects ${shape}, got ${describeValue(value)}`,
    });
    return;
  }

  if (info.createsDependency) {
    const refs = Array.isArray(value) ? value : [value];
    for (const r of refs) {
      const refKey = typeof r === "string" ? r : (r as { ref?: string })?.ref;
      if (!refKey) {
        diags.push({ level: "error", path, message: `expected {ref}, got ${JSON.stringify(r)}` });
        continue;
      }
    }
  }

  // Carried over verbatim from the loop body. Omitting it would silently drop
  // linkCollection entry checking, which existing tests cover.
  if (info.valueKind === "linkCollection" && Array.isArray(value)) {
    for (const entry of value as unknown[]) {
      const link = normalizeLinkCollectionEntry(entry);
      if (typeof link.text !== "string") {
        diags.push({
          level: "error",
          path,
          message: `text field expects a string, got ${link.text === undefined ? "undefined" : describeValue(link.text)}`,
        });
      }
      if (typeof link.href !== "string" && typeof link.ref !== "string") {
        diags.push({ level: "error", path, message: "linkCollection entry expects href or ref" });
      }
    }
  }
}

/** Second-pass: descend into block property values to check that any { ref } inside
 *  a createsDependency child (or a linkCollection child) points at a key that exists.
 *  Mirrors the structure of the top-level second pass; reports the same message text. */
function checkNestedRefs(
  info: PropertyInfo,
  value: unknown,
  path: string,
  schema: SchemaIndex,
  keys: Map<string, number>,
  diags: Diagnostic[],
  depth: number
): void {
  if (info.valueKind === "block" && info.blockType && depth < MAX_BLOCK_DEPTH) {
    const blockType = schema.types[info.blockType.name];
    if (!blockType) return;
    const childByName = new Map(blockType.properties.map((p) => [p.name, p]));
    const walkEntry = (entry: unknown, entryPath: string) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return;
      for (const [childName, childValue] of Object.entries(entry as Record<string, unknown>)) {
        const child = childByName.get(childName);
        if (!child) continue; // already reported by first pass
        checkNestedRefs(child, childValue, `${entryPath}.${childName}`, schema, keys, diags, depth + 1);
      }
    };
    if (info.blockKind === "List") {
      if (!Array.isArray(value)) return;
      (value as unknown[]).forEach((entry, i) => walkEntry(entry, `${path}[${i}]`));
    } else {
      walkEntry(value, path);
    }
    return;
  }

  if (info.createsDependency) {
    const refs = Array.isArray(value) ? value : [value];
    for (const r of refs) {
      const refKey =
        typeof r === "string" ? r
          : typeof r === "object" && r !== null ? (r as { ref?: string }).ref
          : undefined;
      if (refKey && !keys.has(refKey)) {
        diags.push({ level: "error", path, message: `key "${refKey}" not found` });
      }
    }
  }

  if (info.valueKind === "linkCollection" && Array.isArray(value)) {
    for (const rawEntry of value as unknown[]) {
      const entry = normalizeLinkCollectionEntry(rawEntry);
      if (typeof entry.ref === "string" && !keys.has(entry.ref)) {
        diags.push({ level: "error", path, message: `key "${entry.ref}" not found` });
      }
    }
  }
}

export function validatePlan(planInput: ContentPlan, schema: SchemaIndex, now: Date = new Date()): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const parsed = ContentPlanSchema.safeParse(planInput);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diags.push({ level: "error", path: issue.path.join("."), message: issue.message });
    }
    return diags;
  }

  const expandedItems = parsed.data.items.reduce((total, item) => total + (item.count ?? 1), 0);
  if (expandedItems > MAX_PLAN_ITEMS) {
    diags.push({
      level: "error",
      path: "items",
      message: `plan expands to ${expandedItems.toLocaleString(DIAGNOSTIC_LOCALE)} items, but the limit is ${MAX_PLAN_ITEMS.toLocaleString(DIAGNOSTIC_LOCALE)} — reduce count, or split the plan`,
    });
    return diags;
  }

  const plan = expandTemplates(parsed.data, now);
  const typeNames = Object.keys(schema.types);
  const keys = new Map<string, number>();

  plan.items.forEach((item, index) => {
    const key = item.key!;
    const at = `items[${index}](${key})`;

    // Reserve the __ prefix for generated content (e.g. plan folder)
    if (key.startsWith("__")) {
      diags.push({
        level: "error",
        path: at,
        message: `key "${key}" starts with __ — this prefix is reserved for generated content`,
      });
    }
    
    if (keys.has(key)) {
      diags.push({ level: "error", path: at, message: `key "${key}" duplicates items[${keys.get(key)}]` });
    }
    keys.set(key, index);

    const type = schema.types[item.type];
    if (!type) {
      const hint = nearest(item.type, typeNames);
      diags.push({
        level: "error",
        path: at,
        message: `type "${item.type}" does not exist.${hint ? ` Did you mean "${hint}"?` : ""}`,
      });
      return;
    }

    const segment = item.urlSegment ?? (type.kind === "page" ? slugify(item.name) : undefined);
    if (segment && RESERVED_URL_SEGMENTS.has(segment.toLowerCase())) {
      diags.push({
        level: "error",
        path: `${at}.urlSegment`,
        message: `url segment "${segment}" is reserved by the CMS — import rejects it outright`,
      });
    }

    if (item.image && type.kind !== "media") {
      diags.push({
        level: "error",
        path: `${at}.image`,
        message: `image is only valid on a media type, and ${type.name} is not a media type`,
      });
    }

    if (type.kind === "media") {
      const dimensions = [["width", item.image?.width], ["height", item.image?.height]] as const;
      for (const [label, value] of dimensions) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > MAX_IMAGE_DIMENSION)) {
          diags.push({
            level: "error",
            path: `${at}.image.${label}`,
            message: `image.${label} must be an integer between 1 and ${MAX_IMAGE_DIMENSION}, got ${value}`,
          });
        }
      }

      const named = /\.([a-z0-9]+)$/i.exec(item.name);
      if (named && named[1]!.toLowerCase() !== "png") {
        diags.push({
          level: "warning",
          path: `${at}.name`,
          message: `name ends in .${named[1]} but the generator only writes PNG — the blob and url segment will use .png`,
        });
      }

      const ext = type.supportedMediaExtensions;
      if (ext !== undefined) {
        if (!/\bpng\b/i.test(ext)) {
          // Case 1: extensions declared, png not listed → error
          diags.push({
            level: "error",
            path: at,
            message: `${type.name} (base "${type.base}") declares supportedMediaExtensions "${ext}" which does not include png — this type cannot hold a placeholder PNG`,
          });
        }
        // Case 2: extensions declared, png listed → accept, no diagnostic
      } else if (type.base === "Video") {
        // Case 4: no extensions declared, Video base → error
        diags.push({
          level: "error",
          path: at,
          message: `${type.name} (base "Video") cannot hold a still PNG — only image-capable media types are supported`,
        });
      } else if (type.base !== "Image") {
        // Case 5: no extensions declared, other base (e.g. Media) → warn
        diags.push({
          level: "warning",
          path: at,
          message: `${type.name} has base "${type.base}", not "Image" — the CMS generates a thumbnail only for ImageData, so this item may show a generic icon`,
        });
      }
      // Case 3: no extensions declared, Image base → accept, no diagnostic
    }

    const byName = new Map(type.properties.map((p) => [p.name, p]));
    for (const [propName, value] of Object.entries(item.properties ?? {})) {
      const info = byName.get(propName);
      if (!info) {
        diags.push({
          level: "error",
          path: `${at}.properties.${propName}`,
          message: `property "${propName}" does not exist on ${type.name}`,
        });
        continue;
      }
      checkPropertyValue(info, value, `${at}.properties.${propName}`, schema, diags, keys, 0);
    }

    for (const p of type.properties) {
      if (p.required && item.properties?.[p.name] === undefined) {
        diags.push({ level: "error", path: at, message: `required property "${p.name}" is missing a value` });
      }
    }
  });

  // Pixel budget: a count cap prevents memory exhaustion from expandTemplates, but a budget
  // check is still needed because 1000 items at 4096×4096 would block the event loop for minutes.
  let totalPixels = 0;
  for (const item of plan.items) {
    const type = schema.types[item.type];
    if (!type || type.kind !== "media") continue;
    const w = item.image?.width ?? item.image?.height ?? DEFAULT_IMAGE_WIDTH;
    const h = item.image?.height ?? item.image?.width ?? DEFAULT_IMAGE_HEIGHT;
    totalPixels += w * h;
  }
  if (totalPixels > MAX_IMAGE_PIXELS) {
    diags.push({
      level: "error",
      path: "items",
      message: `total image pixel budget exceeded: plan requests ${totalPixels.toLocaleString(DIAGNOSTIC_LOCALE)} pixels across all media items, but the limit is ${MAX_IMAGE_PIXELS.toLocaleString(DIAGNOSTIC_LOCALE)}`,
    });
  }

  // Reference and parent resolution, plus cycle detection.
  plan.items.forEach((item, index) => {
    const key = item.key!;
    const at = `items[${index}](${key})`;
    if (item.parent && item.parent !== "@root" && !keys.has(item.parent)) {
      diags.push({ level: "error", path: `${at}.parent`, message: `key "${item.parent}" not found` });
    }
    const type = schema.types[item.type];
    if (!type) return;
    const byName = new Map(type.properties.map((p) => [p.name, p]));
    
    for (const [propName, value] of Object.entries(item.properties ?? {})) {
      const propInfo = byName.get(propName);
      if (!propInfo) continue;
      checkNestedRefs(propInfo, value, `${at}.properties.${propName}`, schema, keys, diags, 0);
    }

  });

  const state = new Map<string, 0 | 1 | 2>();
  const parentOf = new Map(plan.items.map((i) => [i.key!, i.parent]));
  const visit = (key: string, trail: string[]): void => {
    if (state.get(key) === 2) return;
    if (state.get(key) === 1) {
      diags.push({
        level: "error",
        path: "items",
        message: `parent–child cycle: ${[...trail, key].join(" → ")}`,
      });
      return;
    }
    state.set(key, 1);
    const parent = parentOf.get(key);
    if (parent && parent !== "@root" && parentOf.has(parent)) visit(parent, [...trail, key]);
    state.set(key, 2);
  };
  for (const key of parentOf.keys()) visit(key, []);

  return diags;
}
