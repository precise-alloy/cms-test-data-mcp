import { describe, expect, test } from "bun:test";
import { toolManifest } from "../src/mcp/server";

describe("the manifest budget still holds", () => {
  test("stays under the cap after the list work", () => {
    const size = JSON.stringify(toolManifest).length;
    expect(size).toBeLessThan(12000);
  });
});
