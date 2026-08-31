import type { XAttr, XDocument, XElement, XNode } from "./types";

export * from "./types";

const NAME_END = new Set([" ", "\t", "\n", "\r", "/", ">"]);

function parseAttrs(src: string): XAttr[] {
  const attrs: XAttr[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) break;
    const nameStart = i;
    while (i < src.length && src[i] !== "=" && !/\s/.test(src[i]!)) i++;
    const name = src.slice(nameStart, i);
    if (!name) break;
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (src[i] !== "=") {
      attrs.push({ name, rawValue: "" });
      continue;
    }
    i++; // consume '='
    while (i < src.length && /\s/.test(src[i]!)) i++;
    const quote = src[i]!;
    i++; // consume opening quote
    const valStart = i;
    while (i < src.length && src[i] !== quote) i++;
    attrs.push({ name, rawValue: src.slice(valStart, i) });
    i++; // consume closing quote
  }
  return attrs;
}

export function parseXml(input: string): XDocument {
  let i = 0;
  const bom = input.charCodeAt(0) === 0xfeff;
  if (bom) i = 1;

  let declaration: string | null = null;
  if (input.startsWith("<?xml", i)) {
    const end = input.indexOf("?>", i) + 2;
    declaration = input.slice(i, end);
    i = end;
  }

  const prologStart = i;
  while (i < input.length && /\s/.test(input[i]!)) i++;
  const prologWhitespace = input.slice(prologStart, i);

  const stack: XElement[] = [];
  let root: XElement | null = null;

  while (i < input.length) {
    if (input[i] !== "<") {
      const textStart = i;
      while (i < input.length && input[i] !== "<") i++;
      const raw = input.slice(textStart, i);
      if (stack.length) stack[stack.length - 1]!.children.push({ kind: "text", raw });
      continue;
    }

    // Closing tag
    if (input[i + 1] === "/") {
      i = input.indexOf(">", i) + 1;
      const done = stack.pop()!;
      if (!stack.length) root = done;
      continue;
    }

    // XML comment <!-- ... -->
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4) + 3;
      const raw = input.slice(i, end);
      if (stack.length) stack[stack.length - 1]!.children.push({ kind: "text", raw });
      i = end;
      continue;
    }

    // Processing instruction <?...?> (non-xml declaration ones inside content)
    if (input[i + 1] === "?") {
      const end = input.indexOf("?>", i + 2) + 2;
      const raw = input.slice(i, end);
      if (stack.length) stack[stack.length - 1]!.children.push({ kind: "text", raw });
      i = end;
      continue;
    }

    // CDATA <![CDATA[...]]>
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9) + 3;
      const raw = input.slice(i, end);
      if (stack.length) stack[stack.length - 1]!.children.push({ kind: "text", raw });
      i = end;
      continue;
    }

    // DOCTYPE or other <! constructs
    if (input[i + 1] === "!") {
      const end = input.indexOf(">", i) + 1;
      const raw = input.slice(i, end);
      if (stack.length) stack[stack.length - 1]!.children.push({ kind: "text", raw });
      i = end;
      continue;
    }

    // Opening or self-closing tag
    const gt = input.indexOf(">", i);
    const selfClosing = input[gt - 1] === "/";
    let j = i + 1;
    while (j < gt && !NAME_END.has(input[j]!)) j++;
    const name = input.slice(i + 1, j);
    const attrSrc = input.slice(j, selfClosing ? gt - 1 : gt);
    const el: XElement = { kind: "element", name, attrs: parseAttrs(attrSrc), selfClosing, children: [] };

    if (stack.length) stack[stack.length - 1]!.children.push(el);
    if (selfClosing) {
      if (!stack.length) root = el;
    } else {
      stack.push(el);
    }
    i = gt + 1;
  }

  if (!root) throw new Error("parseXml: no root element found");
  return { bom, declaration, prologWhitespace, root };
}

function writeNode(node: XNode, out: string[]): void {
  if (node.kind === "text") {
    out.push(node.raw);
    return;
  }
  out.push("<", node.name);
  for (const a of node.attrs) out.push(" ", a.name, '="', a.rawValue, '"');
  if (node.selfClosing) {
    out.push(" />");
    return;
  }
  out.push(">");
  for (const c of node.children) writeNode(c, out);
  out.push("</", node.name, ">");
}

export function writeXml(doc: XDocument): string {
  const out: string[] = [];
  if (doc.bom) out.push("\uFEFF");
  if (doc.declaration) out.push(doc.declaration);
  out.push(doc.prologWhitespace);
  writeNode(doc.root, out);
  return out.join("");
}
