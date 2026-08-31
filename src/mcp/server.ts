import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createToolset, type Toolset } from "./tools";
import { ContentPlanSchema } from "../plan/types";
import pkg from "../../package.json";

/**
 * Read from package.json rather than copied into a literal: the version was
 * hardcoded once and went stale at the next bump, leaving the server announcing
 * a build that was no longer running. The bundler inlines this at build time,
 * so there is no runtime file read.
 */
export const SERVER_INFO = { name: "cms-test-data", version: pkg.version } as const;

/**
 * The plan's JSON Schema is generated from the same Zod schema that validates it,
 * so the shape an agent is shown cannot drift from the shape that is enforced.
 * `$schema` is dropped: MCP clients read the object as a plain JSON Schema.
 */
const { $schema: _drop, ...PLAN_SCHEMA } = z.toJSONSchema(ContentPlanSchema) as Record<string, unknown>;

const TOOL_DEFINITIONS = [
  {
    name: "load_schema",
    description:
      "Load the target site's content types from a .episerverdata export. QA produces that file in the CMS under Admin → Export Data, selecting content types only — it is not something this tool can fetch. Every other tool needs the schema and fails until it is loaded. Returns how many content types and property definitions were found, and how many of those properties this tool has no proven way to fill.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the content-type .episerverdata export." },
      },
      required: ["path"],
    },
    handler: (tools: Toolset) => tools.loadSchema,
  },
  {
    name: "usage_guide",
    description:
      "Read this before writing your first content plan. Returns this generator's own guide: what it can and cannot produce, how to choose content types, how to design values that can actually fail a test, image sizing, and what happens on re-import.",
    inputSchema: { type: "object", properties: {} },
    handler: (tools: Toolset) => tools.usageGuide,
  },
  {
    name: "list_content_types",
    description:
      "List the content types this site actually has. Filter by kind and by a substring of the name to find candidates for the content you need. Returns names and property counts only; call describe_content_type for one type's details.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["page", "block", "media", "other"],
          description: "Restrict to one kind of content type.",
        },
        nameContains: { type: "string", description: "Case-insensitive substring of the type name." },
        limit: { type: "number", description: "Maximum types to return. Defaults to 50; the result reports whether it was truncated." },
      },
    },
    handler: (tools: Toolset) => tools.listContentTypes,
  },
  {
    name: "query_schema",
    description:
      "Search the loaded Optimizely content-type schema with bounded filters. Returns matched types or properties, export capability counts, and optional page-tree child availability from <availablecontenttypes> (not ContentArea [AllowedTypes]).",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["page", "block", "media", "other"], description: "Restrict matches to one content type kind." },
        typeNameContains: { type: "string", description: "Case-insensitive substring of the content type name or display name." },
        propertyNameContains: { type: "string", description: "Case-insensitive substring of the property name." },
        captionContains: { type: "string", description: "Case-insensitive substring of the property edit caption." },
        helpTextContains: { type: "string", description: "Case-insensitive substring of exported property HelpText." },
        editorHint: { type: "string", description: "Exact exported EditorHint to match; meanings are site-specific." },
        displayEditUI: { type: "boolean", description: "Match properties by whether they appear in the CMS edit UI." },
        existsOnModel: { type: "boolean", description: "Match properties by whether the export says they exist on the content model." },
        hidden: { type: "boolean", description: "Match properties whose exported Type.Hidden flag equals this value." },
        valueKind: {
          type: "string",
          enum: ["text", "html", "bool", "int", "float", "date", "contentRef", "contentRefList", "contentArea", "linkCollection", "url", "stringList", "block", "unproven"],
          description: "Match the generator's inferred property value kind.",
        },
        savedSince: { type: "string", description: "Match properties with an exported Saved timestamp on or after this value." },
        createdSince: { type: "string", description: "Match content types with an exported Created timestamp on or after this value." },
        includeAvailability: { type: "boolean", description: "Include page-tree child availability from <availablecontenttypes>; this is not ContentArea [AllowedTypes]." },
        limit: { type: "number", description: "Maximum results to return. Defaults to 50 and is clamped to 100." },
      },
    },
    handler: (tools: Toolset) => tools.querySchema,
  },
  {
    name: "describe_content_type",
    description:
      "Describe one content type's properties and return a ready-to-edit plan for it. Each property reports valueKind, required/dependency flags, notes, and why it is omitted from the skeleton when unsupported or export-limited. Start from the skeleton placeholders rather than writing a plan from scratch.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Content type name as reported by list_content_types." },
      },
      required: ["name"],
    },
    handler: (tools: Toolset) => tools.describeContentType,
  },
  {
    name: "validate_plan",
    description:
      "Check a ContentPlan against the loaded schema without writing anything. Errors block generation and name the shape they expected, so they can be corrected without guessing. Warnings do not block: a warning that a property is unproven means that field will be left empty in the CMS, which is the intended behaviour rather than a failure.",
    inputSchema: {
      type: "object",
      properties: { plan: PLAN_SCHEMA },
      required: ["plan"],
    },
    handler: (tools: Toolset) => tools.validatePlanTool,
  },
  {
    name: "build_package",
    description:
      "Generate the .episerverdata file from a ContentPlan. Validates first and writes nothing if there are errors. QA imports the result through Admin → Import Data and chooses there where the content lands, so the plan does not decide that. Returns the written path, the item count, and any warnings worth passing on to QA.",
    inputSchema: {
      type: "object",
      properties: {
        plan: PLAN_SCHEMA,
        outputPath: { type: "string", description: "Where to write the .episerverdata file. Relative paths resolve against the server's working directory." },
      },
      required: ["plan", "outputPath"],
    },
    handler: (tools: Toolset) => tools.buildPackage,
  },
  {
    name: "inspect_package",
    description:
      "Summarise the content tree inside an existing .episerverdata file: which items it carries, their types, and how they nest. Use it to check what a generated package will create before handing it to QA, or to read a package someone else produced.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the .episerverdata file to read." } },
      required: ["path"],
    },
    handler: (tools: Toolset) => tools.inspectPackage,
  },
] as const;

export function createServer(tools: Toolset): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = TOOL_DEFINITIONS.find((d) => d.name === request.params.name);
    if (!def) throw new Error(`Unknown tool: ${request.params.name}`);
    try {
      const result = await (def.handler(tools) as (a: unknown) => Promise<unknown>)(request.params.arguments ?? {});
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }] };
    }
  });

  return server;
}

/** The list a client sees from tools/list. Exported so it can be tested without a transport. */
export const toolManifest = TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

// Guarded so importing this module for its manifest does not open a stdio transport.
if (import.meta.main) {
  const tools = createToolset(process.cwd());
  const server = createServer(tools);
  await server.connect(new StdioServerTransport());
}
