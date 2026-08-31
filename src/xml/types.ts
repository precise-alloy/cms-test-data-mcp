export type XAttr = {
  name: string;
  /** Attribute value exactly as written, still escaped. */
  rawValue: string;
};

export type XElement = {
  kind: "element";
  name: string;
  attrs: XAttr[];
  /** True when the source wrote `<a />` rather than `<a></a>`. */
  selfClosing: boolean;
  children: XNode[];
};

export type XText = {
  kind: "text";
  /** Text exactly as written, still escaped. Never unescape during parse. */
  raw: string;
};

export type XNode = XElement | XText;

export type XDocument = {
  bom: boolean;
  /** The full `<?xml ... ?>` string, or null when absent. */
  declaration: string | null;
  /** Whitespace between declaration and root element. */
  prologWhitespace: string;
  root: XElement;
};
