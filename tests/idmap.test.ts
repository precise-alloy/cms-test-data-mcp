import { describe, expect, test } from "bun:test";
import { assemblePackage } from "../src/pkg/assemble";
import { buildPackageIr } from "../src/plan/build";
import { EMPTY_GUID } from "../src/values/constants";
import type { SchemaIndex } from "../src/schema/types";

const schema: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    ArticlePage: {
      id: 10, guid: "page-guid", name: "ArticlePage", displayName: "Article",
      base: "Page", kind: "page", properties: [],
    },
  },
};

const GUID = "11111111-1111-1111-1111-111111111111";

const idmap = () => {
  const { ir, blobs } = buildPackageIr(
    { planId: "p", items: [{ key: "a", type: "ArticlePage", name: "One" }] },
    schema,
    new Date("2026-01-01T00:00:00Z")
  );
  return assemblePackage(ir, [GUID], blobs).get("idmap.xml")!.toString("utf8");
};

describe("idmap.xml", () => {
  test("maps every guid to itself so a second import updates instead of duplicating", () => {
    const xml = idmap();
    expect(xml).toContain(`<Key>${GUID}</Key>`);
    expect(xml).toContain(`<Value>${GUID}</Value>`);
  });

  test("never writes the empty guid, which the importer replaces with a fresh one", () => {
    expect(idmap()).not.toContain(EMPTY_GUID);
  });
});
