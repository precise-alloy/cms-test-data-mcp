import type { XElement } from "../xml/types";
import { attr, childElements, firstChild, rawText } from "../xml/query";

export type RawPropertyView = {
  name: string;
  type: string;
  typeName?: string;
  isPropertyData: boolean;
  isNull: boolean;
  value?: string;
  /** 1 basic, 2 with TypeName/AssemblyName, 3 Block (no Value), 4 EPi:SystemReference (no CustomData). */
  shape: 1 | 2 | 3 | 4;
  element: XElement;
};

function classify(prop: XElement): 1 | 2 | 3 | 4 {
  const names = childElements(prop).map((c) => c.name);
  const has = (n: string) => names.includes(n);
  if (has("BlockTypeReference")) return 3;
  if (!has("CustomData")) return 4;
  return has("TypeName") ? 2 : 1;
}

function view(prop: XElement): RawPropertyView {
  const get = (n: string) => {
    const el = firstChild(prop, n);
    return el ? rawText(el) : undefined;
  };
  return {
    name: get("Name") ?? "",
    type: get("Type") ?? "",
    typeName: get("TypeName"),
    isPropertyData: get("IsPropertyData") === "true",
    isNull: get("IsNull") === "true",
    value: get("Value"),
    shape: classify(prop),
    element: prop,
  };
}

/** A block's own properties and a list's entries both nest RawProperty elements. */
const NESTED_PROPERTY_CONTAINERS = ["BlockProperties", "ListProperties"] as const;

/**
 * Bounds the walk so a malformed or hostile package cannot drive it into a stack
 * overflow. Real content nests a block within a block a few levels at most.
 */
const MAX_PROPERTY_DEPTH = 10;

/** Stands in for a list slot and carries no property data, so it is not a property. */
function isNilPlaceholder(prop: XElement): boolean {
  return attr(prop, "xsi:nil") === "true";
}

/** Direct properties of an item's RawContentData and each RawContent language branch. */
export function topLevelProperties(item: XElement): RawPropertyView[] {
  const out: RawPropertyView[] = [];
  const collect = (container: XElement | undefined) => {
    if (!container) return;
    // Exports wrap the properties in <Property>. Falling back to the container itself
    // means a package written without that wrapper reports its properties rather than
    // silently reporting none.
    const bag = firstChild(container, "Property") ?? container;
    for (const p of childElements(bag)) {
      if (p.name === "RawProperty" && !isNilPlaceholder(p)) out.push(view(p));
    }
  };
  collect(firstChild(item, "RawContentData"));
  const langData = firstChild(item, "RawLanguageData");
  if (langData) for (const rc of childElements(langData)) collect(rc);
  return out;
}

/**
 * Every property including those nested inside BlockProperties and ListProperties.
 * Depth-aware; never regex. Both containers are walked because ListProperties can
 * hold real property data in customer exports and generated list-kind block output,
 * as well as xsi:nil placeholders for content areas.
 */
export function allProperties(item: XElement): RawPropertyView[] {
  const out: RawPropertyView[] = [];
  const walk = (prop: XElement, depth: number) => {
    out.push(view(prop));
    if (depth >= MAX_PROPERTY_DEPTH) return;
    for (const container of NESTED_PROPERTY_CONTAINERS) {
      const nested = firstChild(prop, container);
      if (!nested) continue;
      for (const c of childElements(nested)) {
        if (c.name === "RawProperty" && !isNilPlaceholder(c)) walk(c, depth + 1);
      }
    }
  };
  for (const p of topLevelProperties(item)) walk(p.element, 0);
  return out;
}

/** Reads top-level properties only; will not find a value nested inside BlockProperties. */
export function propertyValue(item: XElement, name: string): string | undefined {
  return topLevelProperties(item).find((p) => p.name === name)?.value;
}

export function itemGuid(item: XElement): string {
  return propertyValue(item, "PageGUID") ?? "";
}

export function systemReferenceOf(item: XElement): string | undefined {
  return topLevelProperties(item).find((p) => p.name === "EPi:SystemReference")?.value;
}
