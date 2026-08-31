import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { toolManifest, SERVER_INFO, createServer } from "../src/mcp/server";
import { ContentPlanSchema } from "../src/plan/types";
import type { Toolset } from "../src/mcp/tools";

/**
 * The manifest is the only thing an agent sees before its first call, so it is
 * the whole user interface of this server. It shipped with `plan: {type:"object"}`,
 * which told a caller nothing at all — these tests exist so that cannot recur.
 */
describe("the tool manifest an agent reads", () => {
  const byName = new Map(toolManifest.map((t) => [t.name, t]));

  test("exposes exactly the eight tools", () => {
    expect([...byName.keys()].sort()).toEqual([
      "build_package",
      "describe_content_type",
      "inspect_package",
      "list_content_types",
      "load_schema",
      "query_schema",
      "usage_guide",
      "validate_plan",
    ]);
  });

  test("every argument of every tool says what it is for", () => {
    const undescribed: string[] = [];
    for (const tool of toolManifest) {
      const props = (tool.inputSchema as { properties?: Record<string, { description?: string }> }).properties ?? {};
      for (const [arg, spec] of Object.entries(props)) {
        // `plan` carries its description on the fields inside it, checked separately.
        if (arg === "plan") continue;
        if (!spec.description) undescribed.push(`${tool.name}.${arg}`);
      }
    }
    expect(undescribed).toEqual([]);
  });

  test("the plan argument carries the real ContentPlan shape, not a bare object", () => {
    for (const name of ["validate_plan", "build_package"] as const) {
      const plan = (byName.get(name)!.inputSchema as { properties: Record<string, any> }).properties.plan;
      expect(Object.keys(plan.properties).sort()).toEqual(["items", "language", "planId"]);
      expect(plan.required).toEqual(["planId", "items"]);
      const item = plan.properties.items.items;
      expect(Object.keys(item.properties).sort()).toEqual([
        "count", "image", "key", "name", "parent", "properties", "published", "type", "urlSegment", "visibleInMenu",
      ]);
    }
  });

  test("every plan field explains itself, because the field names alone do not", () => {
    const plan = (byName.get("build_package")!.inputSchema as { properties: Record<string, any> }).properties.plan;
    const item = plan.properties.items.items;
    for (const [field, spec] of Object.entries<any>({ ...plan.properties, ...item.properties })) {
      expect(spec.description, `plan field "${field}" has no description`).toBeTruthy();
    }
    // count is meaningless without saying what it counts, and planId decides
    // whether a re-import updates content or duplicates it.
    expect(item.properties.count.description).toContain("{{i}}");
    expect(plan.properties.planId.description).toContain("updates");
  });

  test("the generated plan schema stays in step with the schema that enforces it", () => {
    const generated = (byName.get("build_package")!.inputSchema as { properties: Record<string, any> }).properties.plan;
    const { $schema: _drop, ...fresh } = z.toJSONSchema(ContentPlanSchema) as Record<string, any>;
    expect(generated).toEqual(fresh);
  });

  test("descriptions name the CMS steps a human has to perform", () => {
    expect(byName.get("load_schema")!.description).toContain("Export Data");
    expect(byName.get("build_package")!.description).toContain("Import Data");
  });

  test("usage_guide takes no arguments and fits its manifest budget", () => {
    const usageGuide = byName.get("usage_guide")!;
    expect(usageGuide.inputSchema).toEqual({ type: "object", properties: {} });
    expect(JSON.stringify(usageGuide).length).toBeLessThanOrEqual(434);
  });

  // Measured at 11897 chars, of which the plan schema is 6463 because MCP gives each
  // tool its own inputSchema and two tools take a plan — a $ref across tools would
  // not resolve on the client. The budget guards against drift, not against that.
  // Headroom is down to 103 chars: adding another tool almost certainly means
  // shortening an existing description, so measure before writing one.
  test("the manifest stays small enough to sit in every prompt", () => {
    expect(JSON.stringify(toolManifest).length).toBeLessThan(12000);
  });

  // The version was hardcoded and went stale at the 0.1.3 bump: the server kept
  // announcing 0.1.2, so anyone checking which build a client had connected to was
  // told the wrong thing.
  test("announces the package version rather than a copy of it", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(SERVER_INFO.version).toBe(pkg.version);
    expect(SERVER_INFO.name).toBe("cms-test-data");
  });
});

describe("the tool call response boundary", () => {
  const callTool = async (name: string) => {
    const objectResult = { ok: true, name };
    const tools = {
      loadSchema: async () => objectResult,
      usageGuide: async () => "# Usage guide\n\nWrite useful plans.",
      listContentTypes: async () => objectResult,
      querySchema: async () => objectResult,
      describeContentType: async () => objectResult,
      validatePlanTool: async () => objectResult,
      buildPackage: async () => objectResult,
      inspectPackage: async () => objectResult,
    } as unknown as Toolset;
    const server = createServer(tools) as unknown as {
      _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<{ content: [{ type: string; text: string }] }>>;
    };
    return server._requestHandlers.get("tools/call")!(
      { method: "tools/call", params: { name, arguments: {} } },
      { signal: new AbortController().signal },
    );
  };

  test("emits string results as raw text and object results as pretty JSON", async () => {
    await expect(callTool("usage_guide")).resolves.toEqual({
      content: [{ type: "text", text: "# Usage guide\n\nWrite useful plans." }],
    });

    for (const tool of toolManifest.filter((t) => t.name !== "usage_guide")) {
      await expect(callTool(tool.name)).resolves.toEqual({
        content: [{ type: "text", text: JSON.stringify({ ok: true, name: tool.name }, null, 2) }],
      });
    }
  });
});
