import { z } from "zod";

export const PlanItemSchema = z.object({
  key: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Identifier other items in this plan point at — as their `parent`, or inside a `{ref}` property value. Generated automatically when omitted, so set it only when something references this item."
    ),
  type: z
    .string()
    .min(1)
    .describe("Content type name, spelled exactly as list_content_types reports it."),
  name: z
    .string()
    .min(1)
    .describe("Display name QA will see in the CMS tree."),
  parent: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The `key` of another item in this plan, or "@root" to sit directly under the destination QA picks on import. Pages default to the root. Blocks ignore this — they always go in the plan folder.'
    ),
  urlSegment: z
    .string()
    .optional()
    .describe("URL slug for a page. Derived from `name` when omitted. Ignored for blocks."),
  published: z
    .boolean()
    .optional()
    .describe(
      "Unsupported: imports always publish; false only warns."
    ),
  visibleInMenu: z.boolean().optional().describe("Show the page in navigation. Defaults to true."),
  image: z
    .object({
      width: z.number().int().positive().max(4096).optional(),
      height: z.number().int().positive().max(4096).optional(),
    })
    .optional()
    .describe(
      "Media only. Placeholder PNG size, default 1280x720; set it when aspect ratio matters."
    ),
  count: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe(
      "Produce this many copies of the item instead of one. In `name`, `urlSegment` and any property value, {{i}} becomes 1, 2, 3 … and {{date:+3d}} becomes a date offset from now (d, h or m)."
    ),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Content values keyed by property name, exactly as describe_content_type reports them — its `skeleton` field returns this object already filled with correctly shaped placeholders. Each value must match the property\'s valueKind: string for text and html, boolean for bool, number for int and float, [{ref: "<key>"}] for contentArea and contentRefList, {ref: "<key>"} for contentRef, and for block the block\'s own properties — an object, or an array of them when its Kind is List. Properties whose kind is `unproven` are left empty on purpose.'
    ),
});

export const ContentPlanSchema = z.object({
  planId: z
    .string()
    .min(1)
    .describe(
      "Names this batch. Content GUIDs are derived from it, so importing the same planId again updates the same content instead of creating duplicates, and changing it produces a second, separate set. It also names the folder holding the plan's blocks, so QA can find and delete them in one place."
    ),
  language: z
    .string()
    .min(1)
    .optional()
    .describe('Language branch to create the content in, e.g. "en". Defaults to "en".'),
  items: z
    .array(PlanItemSchema)
    .min(1)
    .describe("The content to create. Order does not matter — references are resolved by `key`."),
});

export type PlanItem = z.infer<typeof PlanItemSchema>;
export type ContentPlan = z.infer<typeof ContentPlanSchema>;

export type Diagnostic = {
  level: "error" | "warning";
  path: string;
  message: string;
};
