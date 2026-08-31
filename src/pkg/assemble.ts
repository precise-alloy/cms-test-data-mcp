import { writeXml } from "../xml/parse";
import { irToEpix } from "../ir/fromXml";
import { childElements } from "../xml/query";
import type { PackageIR } from "../ir/types";
import { writePackage, type PackageParts } from "./read";
import { mimeTypeFor, type MediaBlob } from "../media/blob";
import { EXPORT_CULTURE, EXPORT_VERSION } from "../values/constants";

const BOM = "\uFEFF";

/**
 * Mirrors handleddata/handlermap.xml as real exports write it: the Dynamic Data Store
 * payload plus the handler that would process it. Every one of 33 sampled exports ships
 * this pair, and 31 of them carry an empty payload - only a site with visitor groups
 * fills it - so an empty `<objects />` is the normal case rather than a shortcut.
 *
 * The version is a floor, not a fact. .NET resolves a type when the requested assembly
 * version is at or below the loaded one and returns null when it is above, and it ignores
 * PublicKeyToken outright. A real export records whatever version produced it, which
 * ranged from 10.10.4.0 to 2025.2.14.425 across the sample, so pinning a specific build
 * fails on every older site. 12.0.0.0 sits below every CMS 12 build this generator
 * targets. Exports from CMS 10 and 11 already import into CMS 12 carrying their own lower
 * versions - that is the upgrade path - so a low version here is well-travelled ground.
 */
const HANDLER_MAP =
  BOM +
  '<handlersinfo><handler path="/handleddata/1.xml" ' +
  'AssemblyQualifiedName="EPiServer.Enterprise.DynamicDataTransferHandler, EPiServer.Enterprise, ' +
  'Version=12.0.0.0, Culture=neutral, PublicKeyToken=8fe83dea738b45b7" /></handlersinfo>';

/**
 * Import opens the package with System.IO.Packaging. A part whose extension has no
 * declaration here is not loaded at all, and GetPart then throws PartDoesNotExist -
 * a silent, severe failure. Deriving the list from the parts actually written makes
 * that unreachable.
 */
function buildContentTypes(extensions: Iterable<string>): string {
  const defaults = [...new Set(extensions)]
    .sort()
    .map((ext) => `<Default Extension="${ext}" ContentType="${mimeTypeFor(ext)}" />`)
    .join("");
  return (
    BOM +
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    defaults +
    "</Types>"
  );
}

/**
 * Value repeats Key rather than the empty GUID. An empty value makes the importer mint a
 * fresh GUID for the item unless the Admin screen's "update existing content" box is
 * ticked, and that box defaults to off, so an empty value makes every re-import create
 * duplicates. Confirmed end-to-end against a CMS 12 instance - see DECISION-005.
 */
function buildIdmap(guids: string[]): string {
  const entries = guids
    .map(
      (g) =>
        `  <SerialiazableGuidEntry>\n    <Key>${g}</Key>\n    <Value>${g}</Value>\n  </SerialiazableGuidEntry>`
    )
    .join("\n");
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<ArrayOfSerialiazableGuidEntry xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
    entries +
    "\n</ArrayOfSerialiazableGuidEntry>"
  );
}

function exportFiles(ir: PackageIR, attrs: string): string {
  if (childElements(ir.files).length === 0) return `${BOM}<exportFiles ${attrs} />`;
  const body = writeXml({ bom: false, declaration: null, prologWhitespace: "", root: ir.files });
  return `${BOM}<exportFiles ${attrs}>${body}</exportFiles>`;
}

export function assemblePackage(
  ir: PackageIR,
  itemGuids: string[],
  blobs: MediaBlob[] = []
): PackageParts {
  const attrs = `culture="${EXPORT_CULTURE}" version="${EXPORT_VERSION}"`;
  const parts: PackageParts = new Map();
  const put = (name: string, text: string) => parts.set(name, Buffer.from(text, "utf8"));

  put("epix.xml", writeXml(irToEpix(ir)));
  put("epiDefinition.xml", `${BOM}<exportDefinition ${attrs} />`);
  put("epiMedia.xml", exportFiles(ir, attrs));
  put("epiPostContent.xml", `${BOM}<exportPostContent ${attrs} />`);
  put("idmap.xml", buildIdmap(itemGuids));
  put("handleddata/handlermap.xml", HANDLER_MAP);
  put("handleddata/1.xml", `${BOM}<objects />`);

  for (const blob of blobs) {
    parts.set(blob.entryName.replace(/^\//, ""), blob.bytes);
  }

  // [Content_Types].xml is the content-type stream, not a part, so it never
  // declares itself. Computed last, once every real part is in the map.
  const extensions = [...parts.keys()].map((name) => name.split(".").pop()!.toLowerCase());
  put("[Content_Types].xml", buildContentTypes(extensions));

  return parts;
}

export function writeIrToFile(
  ir: PackageIR,
  itemGuids: string[],
  blobs: MediaBlob[],
  outPath: string
): void {
  writePackage(assemblePackage(ir, itemGuids, blobs), outPath);
}

