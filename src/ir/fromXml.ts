import type { XDocument, XElement } from "../xml/types";
import { attr, childElements, element } from "../xml/query";
import type { PackageIR } from "./types";

export * from "./types";

export function irFromEpix(doc: XDocument): PackageIR {
  const root = doc.root;
  if (root.name !== "export") throw new Error(`irFromEpix: expected <export>, got <${root.name}>`);

  const kids = childElements(root);
  const contentRoots = kids.find((k) => k.name === "contentroots");
  const pagesBlocks = kids.filter((k) => k.name === "pages");
  const files = kids.find((k) => k.name === "files");

  if (!contentRoots) throw new Error("irFromEpix: missing <contentroots>");
  if (pagesBlocks.length !== 2) {
    throw new Error(`irFromEpix: expected exactly 2 <pages> blocks, got ${pagesBlocks.length}`);
  }
  if (!files) throw new Error("irFromEpix: missing <files>");

  const items = (block: XElement) => childElements(block).filter((c) => c.name === "TransferContentData");

  return {
    culture: attr(root, "culture") ?? "",
    version: attr(root, "version") ?? "",
    contentRoots,
    selected: items(pagesBlocks[0]!),
    closure: items(pagesBlocks[1]!),
    files,
  };
}

export function irToEpix(ir: PackageIR): XDocument {
  const pages = (items: XElement[]): XElement =>
    items.length
      ? element("pages", items)
      : { kind: "element", name: "pages", attrs: [], selfClosing: true, children: [] };

  const root: XElement = {
    kind: "element",
    name: "export",
    attrs: [
      { name: "culture", rawValue: ir.culture },
      { name: "version", rawValue: ir.version },
    ],
    selfClosing: false,
    children: [ir.contentRoots, pages(ir.selected), pages(ir.closure), ir.files],
  };

  return { bom: true, declaration: null, prologWhitespace: "", root };
}
