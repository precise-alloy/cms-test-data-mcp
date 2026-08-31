import { parseXml } from "../xml/parse";
import { irFromEpix } from "../ir/fromXml";
import { allProperties } from "../ir/inspect";
import { readPackage } from "../pkg/read";
import type { ValueKind, VocabEntry, Vocabulary } from "./types";

export * from "./types";

/** DataType → ValueKind, used when the property has no TypeName. */
const BY_DATA_TYPE: Record<string, ValueKind> = {
  LongString: "text",
  String: "text",
  Boolean: "bool",
  Number: "int",
  FloatNumber: "float",
  Date: "date",
  ContentReference: "contentRef",
  PageReference: "contentRef",
};

/** EPiServer.* TypeName → ValueKind. Only entries with round-trip evidence belong here. */
const BY_TYPE_NAME: Record<string, ValueKind> = {
  "EPiServer.SpecializedProperties.PropertyContentArea": "contentArea",
  "EPiServer.SpecializedProperties.PropertyXhtmlString": "html",
  "EPiServer.SpecializedProperties.PropertyContentReferenceList": "contentRefList",
  "EPiServer.SpecializedProperties.PropertyLinkCollection": "linkCollection",
  "EPiServer.SpecializedProperties.PropertyUrl": "url",
};

export function inferValueKind(type: string, typeName: string | undefined): ValueKind {
  if (typeName) {
    if (typeName.startsWith("EPiServer.SpecializedProperties.PropertyBlock`1[")) return "block";
    return BY_TYPE_NAME[typeName] ?? "unproven";
  }
  if (type === "Block") return "block";
  return BY_DATA_TYPE[type] ?? "unproven";
}

export function buildVocabulary(fixtures: { name: string; path: string }[]): Vocabulary {
  const entries: Record<string, VocabEntry> = {};

  for (const fx of fixtures) {
    const parts = readPackage(fx.path);
    const ir = irFromEpix(parseXml(parts.get("epix.xml")!.toString("utf8")));
    for (const item of [...ir.selected, ...ir.closure]) {
      for (const p of allProperties(item)) {
        const key = `${p.type}|${p.typeName ?? ""}`;
        const entry = (entries[key] ??= {
          key,
          type: p.type,
          typeName: p.typeName,
          shapes: {},
          occurrences: 0,
          nonEmptySamples: 0,
          fixtures: [],
          valueKind: "unproven",
          samples: [],
        });
        entry.occurrences++;
        entry.shapes[p.shape] = (entry.shapes[p.shape] ?? 0) + 1;
        if (!entry.fixtures.includes(fx.name)) entry.fixtures.push(fx.name);
        const v = p.value ?? "";
        if (v.trim().length > 0) {
          entry.nonEmptySamples++;
          if (entry.samples.length < 3) entry.samples.push(v.slice(0, 400));
        }
      }
    }
  }

  // A kind is only accepted when a real non-empty sample exists. Block is the
  // exception: its payload lives in BlockProperties, not in Value.
  for (const entry of Object.values(entries)) {
    const inferred = inferValueKind(entry.type, entry.typeName);
    entry.valueKind = inferred === "block" || entry.nonEmptySamples > 0 ? inferred : "unproven";
  }

  return {
    generatedAt: new Date().toISOString(),
    fixtures: fixtures.map((f) => f.name),
    entries,
  };
}
