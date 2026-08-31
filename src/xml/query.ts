import type { XElement, XNode } from "./types";

export function childElements(el: XElement): XElement[] {
  return el.children.filter((c): c is XElement => c.kind === "element");
}

export function firstChild(el: XElement, name: string): XElement | undefined {
  for (const c of el.children) {
    if (c.kind === "element" && c.name === name) return c;
  }
  return undefined;
}

/** Concatenated raw (still-escaped) text of an element's direct text children. */
export function rawText(el: XElement): string {
  let out = "";
  for (const c of el.children) if (c.kind === "text") out += c.raw;
  return out;
}

export function attr(el: XElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.rawValue;
}

export function element(name: string, children: XNode[] = [], attrs: XElement["attrs"] = []): XElement {
  return { kind: "element", name, attrs, selfClosing: children.length === 0, children };
}

export function textNode(raw: string): XNode {
  return { kind: "text", raw };
}
