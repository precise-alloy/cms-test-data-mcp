import type { ValueKind } from "../vocab/types";
import { CONTENT_AREA_CLASS_ID } from "./constants";

/**
 * Resolves a reference key to the item's GUID (lowercase hyphenated) and display name.
 * Call sites normalise case defensively at every emission point.
 */
export type RefResolver = (key: string) => { guid: string; name: string };

export type SerializedValue = {
  /** Ready to place inside <Value>, already escaped. */
  value: string;
  /** Number of <RawProperty xsi:nil="true" /> entries needed in <ListProperties>. */
  listCount: number;
};

export function guidNoDashes(guid: string): string {
  return guid.replace(/-/g, "").toLowerCase();
}

/**
 * Code points XML 1.0 forbids outright: the C0 controls other than tab, LF and CR,
 * unpaired surrogates, and the two non-characters. Real exports carry them, and one
 * copied into a generated package makes the importer's .NET XML reader reject the
 * whole file rather than the offending value - so they are dropped here, at the single
 * point every string passes through on its way into the document.
 */
const ILLEGAL_XML_CODE_POINTS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/** The format escapes only these three. Quotes and apostrophes are left alone. */
export function escapeXml(s: string): string {
  return s
    .replace(ILLEGAL_XML_CODE_POINTS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttribute(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function attr(name: string, value: string): string {
  return `${name}="${escapeXmlAttribute(value)}"`;
}

export function formatDate(d: Date): string {
  return d.toUTCString();
}

type RefInput = { ref: string } | string;

function resolveRef(input: RefInput, resolve: RefResolver): { guid: string; name: string } {
  if (typeof input === "string") return resolve(input);
  return resolve(input.ref);
}

export function bracketRef(guid: string): string {
  return `[${guidNoDashes(guid)}][][]`;
}

export function serializeValue(kind: ValueKind, input: unknown, resolve: RefResolver): SerializedValue {
  const plain = (value: string): SerializedValue => ({ value, listCount: 0 });

  switch (kind) {
    case "text":
    case "html":
      return plain(escapeXml(String(input)));

    case "bool": {
      if (typeof input === "boolean") return plain(input ? "True" : "False");
      if (typeof input === "string") {
        const lower = input.toLowerCase();
        if (lower === "true") return plain("True");
        if (lower === "false") return plain("False");
      }
      throw new Error(`serializeValue: invalid bool value: ${String(input)}`);
    }

    case "int": {
      const n = Number(input);
      if (input === null || input === "" || !Number.isFinite(n))
        throw new Error(`serializeValue: invalid int value: ${String(input)}`);
      return plain(String(Math.trunc(n)));
    }

    case "float": {
      const n = Number(input);
      if (input === null || input === "" || !Number.isFinite(n))
        throw new Error(`serializeValue: invalid float value: ${String(input)}`);
      return plain(String(n));
    }

    case "date": {
      const d = input instanceof Date ? input : new Date(String(input));
      if (Number.isNaN(d.getTime())) throw new Error(`serializeValue: invalid date ${String(input)}`);
      return plain(formatDate(d));
    }

    case "contentRef":
      return plain(bracketRef(resolveRef(input as RefInput, resolve).guid));

    case "contentRefList": {
      const refs = (input as RefInput[]).map((r) => bracketRef(resolveRef(r, resolve).guid));
      return plain(escapeXml(JSON.stringify(refs)));
    }

    case "contentArea": {
      const items = input as ({ ref: string; displayOption?: string } | string)[];
      const divs = items.map((item) => {
        const { guid, name } = resolveRef(item as RefInput, resolve);
        const displayOption = typeof item === "object" ? item.displayOption : undefined;
        const attrs = [
          attr("data-classid", CONTENT_AREA_CLASS_ID),
          attr("data-contentgroup", ""),
          attr("data-contentguid", guid.toLowerCase()),
          attr("data-contentname", name),
          ...(displayOption ? [attr("data-epi-content-display-option", displayOption)] : []),
        ].join(" ");
        return `<div ${attrs}>{}</div>`;
      });
      return { value: escapeXml(divs.join("")), listCount: items.length };
    }

    case "linkCollection": {
      const links = input as unknown[];
      const lis = links.map((entry) => {
        if (!entry || typeof entry !== "object") {
          throw new Error("serializeValue: linkCollection entry field expects an object");
        }
        const l = entry as { text?: unknown; href?: unknown; ref?: unknown };
        if (typeof l.text !== "string") {
          throw new Error("serializeValue: linkCollection text field expects a string");
        }
        const href = typeof l.href === "string"
          ? l.href
          : typeof l.ref === "string"
            ? `~/link/${guidNoDashes(resolve(l.ref).guid)}.aspx`
            : undefined;
        if (href === undefined) {
          throw new Error("serializeValue: linkCollection href/ref field expects a string");
        }
        const text = escapeXml(l.text);
        // href attribute before title, as it is the most common order in real fixtures
        const attrs = [attr("href", href), attr("title", l.text)].join(" ");
        return `<li><a ${attrs}>${text}</a></li>`;
      });
      return plain(escapeXml(`<ul>${lis.join("")}</ul>`));
    }

    case "url": {
      if (typeof input === "string") return plain(escapeXml(input));
      const { guid } = resolveRef(input as RefInput, resolve);
      return plain(`~/link/${guidNoDashes(guid)}.aspx`);
    }

    // 81 occurrences in fixtures, 0 non-empty. No real sample exists.
    case "stringList":
    case "unproven":
      throw new Error(
        "serializeValue: property type is unproven — no fixture provides a real sample, so the value must be left null"
      );

    case "block":
      throw new Error("serializeValue: block properties are written by the item serializer, not here");
  }
}
