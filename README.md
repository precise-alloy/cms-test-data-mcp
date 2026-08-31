# cms-test-data-mcp

An MCP server that turns a content plan into an importable Optimizely CMS 12
`.episerverdata` package.

The generator never touches a CMS. It reads a content-type export and writes a
file; a human exports the schema and a human imports the result under
**Admin → Import Data**.

## Use it

```json
{
  "mcpServers": {
    "cms-test-data": {
      "command": "bunx",
      "args": ["cms-test-data-mcp@0.0.1"]
    }
  }
}
```

Pin the version. An unpinned spec is re-resolved on every session start instead
of being served from cache — on Windows that measured ~11s per start versus
~0.7s pinned.

`npx` works the same way if you would rather not use Bun.

## Tools

| Tool | Purpose |
|---|---|
| `load_schema` | Load the site's content types from an **Admin → Export Data** export (content types only). Every other tool fails until this succeeds. |
| `usage_guide` | Return the bundled guide for choosing values, understanding import behavior, and packaging Optimizely CMS test content. |
| `list_content_types` | Find the types the site actually has, filtered by kind or name. |
| `query_schema` | Bounded schema discovery with filters for type/property names, captions, help text, editor hints, edit-UI visibility, model existence, value kind, timestamps, and optional page-tree child availability. |
| `describe_content_type` | One type's full property list, notes for export limitations, skeleton omission reasons, and a ready-to-edit plan skeleton for fillable fields. |
| `validate_plan` | Check a plan without writing anything. Errors name the shape they expected; warnings flag supplied values that will not be applied, plus caveats about content that is still produced. |
| `build_package` | Write the `.episerverdata` file, warning about dropped supplied values and the same content caveats. |
| `inspect_package` | Summarise the content tree inside an existing package. |

Use `query_schema` before `describe_content_type` when you need to narrow a large export by metadata rather than
dumping broad type lists into the prompt. Query results are capped and report `total`, `truncated`, and `limit`;
the default limit is 50 and the maximum is 100.

## Media

A media item is an ordinary plan item whose content type is a media type. Give it an
`image` size and the generator writes a placeholder PNG into the package:

```json
{
  "planId": "hero-layout-qa",
  "items": [
    { "key": "hero-img", "type": "ImageFile", "name": "hero.png",
      "image": { "width": 1600, "height": 900 } },

    { "key": "home", "type": "StandardPage", "name": "Home",
      "properties": { "HeroImage": { "ref": "hero-img" } } }
  ]
}
```

Referencing costs nothing: one media item pointed at by twenty pages is still one item and
one file. Only `count` on the media item itself produces several. Images land in the global
assets folder, and QA can replace one in the CMS afterwards — uploading over a placeholder
is an ordinary upload and regenerates the thumbnail.

The bytes are always PNG whatever the item is named, because writing PNG bytes into a
`.jpg` file would produce something that looks right and is not. Size is never guessed from
the property: content-type exports carry no `[ImageDescriptor]`, so state the size when the
layout depends on aspect ratio. The default is 1280x720.

The image is a test pattern, not a flat colour, because a flat colour hides the bug you are
looking for — squash one into the wrong aspect ratio and it still looks like itself. The
circle is sized by the shorter side, so it turns into an ellipse the moment the ratio is
not preserved; the grid cells are square for the same reason; the corner brackets go
missing when the image is cropped; and the label names the size the plan asked for, so a
wrong rendition shows without opening the asset.

Thumbnails are left empty on purpose. `ImageData.Thumbnail` is declared
`[ImageDescriptor(Width = 48, Height = 48, Pregenerated = true)]`, so the CMS generates one
from the image; writing a placeholder would suppress that permanently.

## Re-importing a plan

Content GUIDs derive from `planId` and each item's `key`, so importing the same plan twice
updates the same content instead of creating a second copy. Verified against a real CMS 12: a
second import duplicates nothing, and neither the media items nor their binaries are re-created.

**Pick the same destination each time, or the content moves.** Recognising the content by
GUID is what lets the CMS update it — and the same recognition means that when the second
import names a different destination, the existing items are relocated there rather than
copied. The importer skips an item only when it is unchanged *and* already sits under the
chosen destination; a different destination fails that test and the item is moved. Media is
the exception: it is pinned to the global assets folder on every import, so pages move and
images stay.

To create a genuinely separate set rather than updating the existing one, change the
`planId`. Keys matter as much: because identity is the `planId` and key together, changing an
item's key — including by changing which auto-generated key it receives — creates a duplicate
rather than an update. Those two are the control, not the **update existing content**
checkbox, which this package's identity mapping deliberately makes irrelevant.

## Limits

Unpublished content, more than one language, `Category` and
untyped `Json` are not generated. SVG, PDF and video media are not generated either — the
CMS cannot rasterise them for a thumbnail. Any property type with no proven serialisation
is left empty with a warning rather than guessed — a wrong guess produces content that
looks right and is subtly incorrect.

`describe_content_type` lists every property, including fields that are hidden,
not shown in CMS edit mode, or no longer present on the content model. Its skeleton
omits only values the generator cannot serialize (`unproven`, and a `block` property
when the export carries no block type for it) and names the omission reason in-band.

The export does not contain enum labels/values, ContentArea `[AllowedTypes]`, or
`[ScaffoldColumn]` metadata. Integer fields therefore carry an advisory enum-label
note in schema discovery for QA to confirm legal values in CMS edit mode; do not invent a value set.
The parsed `<availablecontenttypes>` section is page-tree child availability only,
not ContentArea `[AllowedTypes]`.
`editorHint` values are reported verbatim from the export and are site-specific;
their meaning varies by site and installed plugin.

Working: pages, blocks, nested page trees, text, HTML, ContentArea, content
references, inline block properties, `{{date:±Nd}}` / `{{date:±Nh}}` / `{{date:±Nm}}` tokens, and PNG media.

## Name and trademarks

This is an independent community project. It is **not affiliated with, endorsed by,
sponsored by, or supported by Optimizely**, and it bundles, links or redistributes no
Optimizely code.

OPTIMIZELY® and EPISERVER® are trademarks or registered trademarks of Optimizely North
America Inc. or its related entities, used here only to describe the product this tool
builds content for.
