import { describe, expect, test } from "bun:test";
import { assemblePackage } from "../src/pkg/assemble";
import { buildPackageIr } from "../src/plan/build";
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

const parts = () => {
  const { ir, blobs } = buildPackageIr(
    { planId: "p", items: [{ key: "a", type: "ArticlePage", name: "One" }] },
    schema,
    new Date("2026-01-01T00:00:00Z")
  );
  return assemblePackage(ir, ["11111111-1111-1111-1111-111111111111"], blobs);
};

const text = (name: string) => parts().get(name)!.toString("utf8");

describe("handleddata, the Dynamic Data Store payload", () => {
  test("ships the pair every real export ships, even with nothing to transfer", () => {
    const names = [...parts().keys()];
    expect(names).toContain("handleddata/handlermap.xml");
    expect(names).toContain("handleddata/1.xml");
  });

  test("carries an empty object set, because a generated plan has no visitor groups", () => {
    expect(text("handleddata/1.xml")).toContain("<objects />");
  });

  test("points the handler at the payload file it actually writes", () => {
    expect(text("handleddata/handlermap.xml")).toContain('path="/handleddata/1.xml"');
  });

  test("pins the assembly version to the CMS 12 floor rather than to a specific build", () => {
    const version = /Version=([\d.]+)/.exec(text("handleddata/handlermap.xml"))?.[1];
    // .NET binds a requested version at or below the loaded one and returns null above it,
    // so a build-specific version such as 12.24.1.0 resolves only on sites at or past that
    // build. Every field after the major must stay zero for the floor to hold.
    expect(version).toBe("12.0.0.0");
    expect(version!.split(".").slice(1)).toEqual(["0", "0", "0"]);
  });
});
