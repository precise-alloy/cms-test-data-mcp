import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createToolset } from "../src/mcp/tools";

const outDir = join(process.cwd(), ".test-output");

function writePackage(path: string, entries: Record<string, string>): void {
  mkdirSync(outDir, { recursive: true });
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content, "utf8"));
  zip.writeZip(path);
}

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("tool schema errors", () => {
  test("reports schema-not-loaded calls clearly", async () => {
    const tools = createToolset(process.cwd());

    await expect(tools.listContentTypes({})).rejects.toThrow("Schema not loaded. Call load_schema first.");
    await expect(tools.describeContentType({ name: "Anything" })).rejects.toThrow("Schema not loaded. Call load_schema first.");
    await expect(tools.validatePlanTool({ plan: { planId: "p", items: [] } })).rejects.toThrow("Schema not loaded. Call load_schema first.");
    await expect(tools.buildPackage({ plan: { planId: "p", items: [] }, outputPath: join(outDir, "out.episerverdata") })).rejects.toThrow("Schema not loaded. Call load_schema first.");
  });

  test("query_schema reports schema-not-loaded calls clearly", async () => {
    const tools = createToolset(process.cwd());

    await expect(tools.querySchema({})).rejects.toThrow("Schema not loaded. Call load_schema first.");
  });

  test("load_schema surfaces parse errors from missing epiDefinition.xml", async () => {
    const path = join(outDir, "missing.episerverdata");
    writePackage(path, { "not-epiDefinition.xml": "<xml />" });
    const tools = createToolset(process.cwd());

    await expect(tools.loadSchema({ path })).rejects.toThrow("parseSchema: missing epiDefinition.xml");
  });

  test("load_schema reports a missing export path clearly", async () => {
    const path = join(outDir, "does-not-exist.episerverdata");
    const tools = createToolset(process.cwd());

    await expect(tools.loadSchema({ path })).rejects.toThrow(`parseSchema: failed to read "${path}" as an .episerverdata ZIP export`);
  });

  test("load_schema reports invalid export bytes clearly", async () => {
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, "invalid.episerverdata");
    writeFileSync(path, "not a zip export");
    const tools = createToolset(process.cwd());

    await expect(tools.loadSchema({ path })).rejects.toThrow(`parseSchema: failed to read "${path}" as an .episerverdata ZIP export`);
  });

  test("describe_content_type suggests the nearest known content type", async () => {
    const path = join(outDir, "types.episerverdata");
    writePackage(path, {
      "epiDefinition.xml": `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject><ContentTypeTransferObject><ID>1</ID><GUID>guid</GUID><Name>IconItemBlock</Name><DisplayName>Icon Item Block</DisplayName><Base>Block</Base><PropertyDefinitions /></ContentTypeTransferObject></ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`,
    });
    const tools = createToolset(process.cwd());
    await tools.loadSchema({ path });

    await expect(tools.describeContentType({ name: "IconItemBloc" })).resolves.toEqual({
      error: 'type "IconItemBloc" does not exist. Did you mean "IconItemBlock"?',
    });
  });

  test("zero content types load predictably and return empty query results", async () => {
    const path = join(outDir, "zero-types.episerverdata");
    writePackage(path, {
      "epiDefinition.xml": `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject /></contenttypes></exportDefinition>`,
    });
    const tools = createToolset(process.cwd());

    await expect(tools.loadSchema({ path })).resolves.toMatchObject({ contentTypes: 0, properties: 0, unprovenProperties: 0 });
    await expect(tools.listContentTypes({})).resolves.toMatchObject({ total: 0, truncated: false, types: [] });
    await expect(tools.querySchema({})).resolves.toMatchObject({ total: 0, truncated: false, results: [] });
    await expect(tools.describeContentType({ name: "MissingBlock" })).resolves.toEqual({ error: 'type "MissingBlock" does not exist.' });
  });

  test("content types with zero properties describe with an empty skeleton properties object", async () => {
    const path = join(outDir, "zero-properties.episerverdata");
    writePackage(path, {
      "epiDefinition.xml": `<exportDefinition culture="en" version="4"><contenttypes><ArrayOfContentTypeTransferObject><ContentTypeTransferObject><ID>1</ID><GUID>guid</GUID><Name>EmptyBlock</Name><DisplayName>Empty Block</DisplayName><Base>Block</Base><PropertyDefinitions /></ContentTypeTransferObject></ArrayOfContentTypeTransferObject></contenttypes></exportDefinition>`,
    });
    const tools = createToolset(process.cwd());
    await tools.loadSchema({ path });

    await expect(tools.describeContentType({ name: "EmptyBlock" })).resolves.toMatchObject({
      name: "EmptyBlock",
      properties: [],
      skeleton: { items: [{ properties: {} }] },
    });
  });
});
