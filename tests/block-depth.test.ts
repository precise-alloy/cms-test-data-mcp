import { describe, expect, test } from "bun:test";
import { buildPackageIr } from "../src/plan/build";
import type { SchemaIndex } from "../src/schema/types";

const blockRef = (name: string) => ({
  guid: `guid-${name}`,
  name,
  modelTypeString: `Acme.Models.${name}, Acme.Models, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`,
});

/** A block type that contains itself, which must be reported rather than recursed into. */
const cyclic: SchemaIndex = {
  culture: "en-US",
  version: "4",
  types: {
    LoopBlock: {
      id: 40, guid: "loop", name: "LoopBlock", displayName: "Loop",
      base: "Block", kind: "block",
      properties: [
        { id: 700, name: "Inner", tabId: 0, dataType: "Block",
          required: false, languageSpecific: false, editCaption: "Inner",
          valueKind: "block", createsDependency: false, blockType: blockRef("LoopBlock") },
      ],
    },
    HostPage: {
      id: 10, guid: "host", name: "HostPage", displayName: "Host",
      base: "Page", kind: "page",
      properties: [
        { id: 500, name: "Loop", tabId: 0, dataType: "Block",
          required: false, languageSpecific: false, editCaption: "Loop",
          valueKind: "block", createsDependency: false, blockType: blockRef("LoopBlock") },
      ],
    },
  },
};

const nest = (levels: number): Record<string, unknown> =>
  levels === 0 ? {} : { Inner: nest(levels - 1) };

describe("inline block nesting", () => {
  test("a plan nesting past the cap is rejected rather than expanded", () => {
    expect(() =>
      buildPackageIr(
        { planId: "deep", items: [
          { key: "host", type: "HostPage", name: "Host", properties: { Loop: nest(6) } },
        ] },
        cyclic,
        new Date("2026-01-01T00:00:00Z")
      )
    ).toThrow("depth");
  });

  test("a self-referential block type still builds at shallow depth", () => {
    const { ir } = buildPackageIr(
      { planId: "shallow", items: [
        { key: "host", type: "HostPage", name: "Host", properties: { Loop: { Inner: {} } } },
      ] },
      cyclic,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(ir.selected.length).toBe(1);
  });
});
