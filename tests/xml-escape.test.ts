import { describe, expect, test } from "bun:test";
import { escapeXml, escapeXmlAttribute } from "../src/values/serialize";

/**
 * Content-type names and captions travel from a customer's export into the generated
 * package. One code point XML forbids makes the importer's .NET reader reject the whole
 * file rather than the offending value, so they are dropped instead of escaped.
 */
describe("text on its way into the package", () => {
  test("still escapes the three characters the format reserves", () => {
    expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  test("leaves quotes and apostrophes to the attribute escaper", () => {
    expect(escapeXml(`say "hi" it's`)).toBe(`say "hi" it's`);
    expect(escapeXmlAttribute(`say "hi" it's`)).toBe("say &quot;hi&quot; it&apos;s");
  });

  test("drops the C0 controls XML forbids while keeping tab, newline and return", () => {
    expect(escapeXml("a\u0000\u0002\u001Fb")).toBe("ab");
    expect(escapeXml("a\u000B\u000Cb")).toBe("ab");
    expect(escapeXml("a\t\n\rb")).toBe("a\t\n\rb");
  });

  test("keeps the control-looking characters XML 1.0 actually allows", () => {
    expect(escapeXml("a\u007Fb")).toBe("a\u007Fb");
    expect(escapeXml("a\u0085b")).toBe("a\u0085b");
  });

  test("keeps an astral character but drops an unpaired surrogate", () => {
    expect(escapeXml("a\u{1F600}b")).toBe("a\u{1F600}b");
    expect(escapeXml("a\uD83Db")).toBe("ab");
    expect(escapeXml("a\uDE00b")).toBe("ab");
  });

  test("drops the two non-characters", () => {
    expect(escapeXml("a\uFFFE\uFFFFb")).toBe("ab");
  });

  test("sanitises before escaping, so a stripped control cannot split an entity", () => {
    expect(escapeXml("&\u0002amp;")).toBe("&amp;amp;");
  });

  test("sanitises idempotently, though escaping deliberately does not", () => {
    expect(escapeXml(escapeXml("a\u0002b"))).toBe("ab");
    expect(escapeXml(escapeXml("&"))).toBe("&amp;amp;");
  });

  test("escapes an attribute value that carries a forbidden code point", () => {
    expect(escapeXmlAttribute('a\u0002"<b')).toBe("a&quot;&lt;b");
  });
});
