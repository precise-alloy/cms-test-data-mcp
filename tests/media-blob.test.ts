import { describe, expect, test } from "bun:test";
import { makeMediaBlob, mimeTypeFor } from "../src/media/blob";

const CONTENT = "36665EE5-211F-4CA1-B50A-47AA317439A1";
const BLOB = "15f30fd1-5318-4b77-90de-c534fc0bd42f";
const bytes = Buffer.from([1, 2, 3]);
const blob = () => makeMediaBlob(CONTENT, BLOB, "png", bytes);

describe("makeMediaBlob", () => {
  test("builds the url the BinaryData property carries, with a single slash", () => {
    expect(blob().url).toBe(
      "epi.fx.blob://default/36665ee5211f4ca1b50a47aa317439a1/15f30fd153184b7790dec534fc0bd42f.png"
    );
  });

  test("builds the zip entry name with the doubled slash the importer expects", () => {
    expect(blob().entryName).toBe(
      "/epi.fx.blob://default/36665ee5211f4ca1b50a47aa317439a1//15f30fd153184b7790dec534fc0bd42f.png"
    );
  });

  test("splits the url into the provider name and relative path epiMedia.xml needs", () => {
    const b = blob();
    expect(b.providerName).toBe("epi.fx.blob://default/36665ee5211f4ca1b50a47aa317439a1/");
    expect(b.providerRelativePath).toBe("15f30fd153184b7790dec534fc0bd42f.png");
    expect(b.entryName).toBe("/" + b.providerName + "/" + b.providerRelativePath);
  });

  test("derives the permanent link from the content guid, not the blob guid", () => {
    expect(blob().permanentLinkVirtualPath).toBe("~/link/36665ee5211f4ca1b50a47aa317439a1.png");
  });

  test("carries the bytes and extension through unchanged", () => {
    expect(blob().bytes).toBe(bytes);
    expect(blob().extension).toBe("png");
  });

  test("normalises an extension supplied with a leading dot or in upper case", () => {
    expect(makeMediaBlob(CONTENT, BLOB, ".PNG", bytes).extension).toBe("png");
  });
});

describe("mimeTypeFor", () => {
  test("maps the extensions a generated package can contain", () => {
    expect(mimeTypeFor("xml")).toBe("text/xml");
    expect(mimeTypeFor("png")).toBe("image/png");
  });

  test("falls back to octet-stream, matching what real exports do for webp", () => {
    expect(mimeTypeFor("webp")).toBe("application/octet-stream");
    expect(mimeTypeFor("nonsense")).toBe("application/octet-stream");
  });
});
