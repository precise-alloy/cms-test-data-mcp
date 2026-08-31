# Generating Optimizely CMS 12 test data

## Overview

You are driving an MCP server that turns a content plan into a `.episerverdata` file. A person with CMS access exports the site's content-type definitions first, then imports the generated package afterward.

The tool manifest tells you the shape of every argument. This guide covers what the manifest cannot: how to choose what to generate, how to design values that expose defects, and how to interpret generator results.

**Core principle:** the generator never touches the CMS. It reads an export and writes a file. A human moves data in both directions.

## The two human steps

```text
CMS user: Admin -> Export Data     you: load_schema -> build_package     CMS user: Admin -> Import Data
          (content types only)          (never touches the CMS)                    (picks the destination)
```

Before you can build anything, you need the site's content types. Ask someone with CMS access to produce an export under **Admin -> Export Data**, selecting content types only.

Ask for content types, never for a content export. A content export carries real site content, and you do not need it. Everything the generator classifies comes from type definitions.

After you produce the package, whoever runs **Admin -> Import Data** chooses the destination in the CMS. Nothing in the plan chooses where pages land, so do not promise a page location in advance.

## Choosing what to generate

**Use the types the site actually has.** Read them from `list_content_types`; do not assume an `ArticlePage` or a `HeroBlock` exists because many sites have something like one. Use `query_schema` before `describe_content_type` when you need metadata filters: property name, caption, help text, picker `editorHint`, hidden or edit-UI-invisible fields, fields missing from the model, value kind, or changed-since discovery. `query_schema` is bounded and reports `total`, `truncated`, and `limit`, so it avoids dumping a large schema into the prompt. If nothing matches the requested scenario, say so and ask which type is intended; a plausible wrong type produces content that tests nothing.

**Generate enough to exercise the case, and no more.** That governs breadth as well as volume: build the types, properties and pages the case actually checks, not every field the type offers and not the neighboring features that happen to share the template. Content nobody asserts on is noise a reviewer has to triage before finding the part that matters. A listing that needs "several" articles needs a small distinguishable set, not a bulk import. Use `count` with `{{i}}` instead of repeating near-identical items by hand.

**Put the blocks under test on one page.** When a case exercises variants of a block, collect them in a single page's ContentArea instead of giving each its own page: a reviewer compares them by scrolling rather than navigating, and cleanup is one page instead of several. Splitting them across pages by theme adds tree noise without adding coverage. Use separate pages when the case needs them — when the variants would interfere with each other on one page, when the case is about page-level behavior such as templates, URL segments, navigation or SEO fields, when more than one page type is part of the scenario, or when the requester asked for a split. This is about pages created only to hold the blocks; pages that *are* the data, such as the children a listing pages over, are the case and stay as many as it needs.

**Make it findable and disposable.** Names appear in the CMS tree, so make them recognizable and scoped to the scenario: `"Search results - empty state 1"` is better than `"Test page 1"`. Blocks are collected in the `planId` folder, pages stay under the import destination, and media lands in global assets, so cleanup has to cover all three places.

**Reuse `planId` deliberately.** Content GUIDs derive from `planId` and each item's `key`, so re-importing the same stable pair updates the same content instead of creating a second copy. That is right while iterating on one scenario and wrong when a fresh independent set is needed; for a separate set, change the `planId` or the relevant keys. Changing a key, including by changing which auto-generated key an item receives, creates a duplicate rather than an update. The **update existing content** checkbox on the import screen does not change the outcome, because the package preserves identity either way.

**Import repeated revisions to the same destination.** Recognizing content by GUID is what makes an update an update. The same recognition means that re-importing the same `planId` to a different destination **moves** existing pages there rather than copying them. They disappear from the first destination, which looks like data loss if the importer was not warned. This is the CMS's own update behavior, not a package option. Media is the exception: it is pinned to the site's global assets folder on every import, so images stay put while pages move.

## Designing the values

Choosing the content type is only half the job. The values decide whether the generated content can tell a working implementation from a broken one.

**Derive every value from the expected result.** Read what the case asserts, then ask what the data must look like for that assertion to fail if the site is wrong. A case that expects newest-first sorting cannot fail against articles published on the same day; give them different date tokens such as `{{date:-1d}}`, `{{date:-8d}}`, and `{{date:-30d}}`, and create them out of display order.

**Make checked values distinguishable.** Distinct names are enough when the case counts items. They are not enough when it checks which item rendered where. If the case reads a teaser, the teasers must differ; identical body text hides exactly the defect the case exists to expose.

**Generate past named boundaries.** "Shows the first five" needs more than five items, or truncation never happens. "Falls back when there is no image" needs an item with no image, not a populated one someone has to edit by hand. A length limit needs one value at the limit and, when truncation is part of the case, one over it.

**An empty state is data too.** A case about "no results" needs real content that yields nothing: an empty ContentArea, a category with no children, or whichever empty condition the site actually checks. Do not leave the result to be created by deleting content after import.

**Use text that survives the round trip.** Encoding bugs live in accented and non-Latin characters, `&`, quotes, and angle brackets. ASCII-only filler rarely finds them. When the site serves non-English content, at least one item should carry realistic text in that language.

**Give images the dimensions the case is about.** A media item accepts `image: { width, height }`; the generator writes a placeholder PNG at that size and defaults to `{{DEFAULT_IMAGE_WIDTH}}×{{DEFAULT_IMAGE_HEIGHT}}` when no size is supplied. A lone `width` or `height` is used for both axes, producing a square. The size is never inferred from the property, because content-type exports carry no dimension metadata. A case about a hero aspect ratio, a square avatar, a portrait card, cropping, or a responsive breakpoint has to name the pixels. A case that only needs "an image present" should omit `image` and take the default.

**Explain non-obvious values in nearby prose outside the plan.** A date far in the past for an archive case or a title at an exact length for an SEO rule should be called out so a reviewer can tell a deliberate boundary from a typo.

## Interpreting results

**Errors block generation.** They name the property or item and the shape expected. Fix the plan and validate again.

**Warnings do not block.** `validate_plan` and `build_package` warn when a supplied value will not be applied as given, such as unproven serialization left empty, or unsupported publication status ignored. `describe_content_type` and `query_schema` carry broader advisory notes: `DisplayEditUI=false` means the field is not shown in CMS edit mode, and `ExistsOnModel=false` means the export contains a property no longer present on the current model.

**Always report which fields will be empty.** The person checking the CMS sees a page, not your warning list. An unexplained blank field looks like a site bug. `describe_content_type` lists every property and marks skeleton omissions before you build; `validate_plan` and `build_package` warn for dropped supplied values and other caveats. Media can also warn about content that is still produced, so build the empty-field list from schema discovery first and reconcile build warnings afterward.

**Treat absent metadata as a limitation, not a puzzle.** Content-type exports do not carry enum labels or values, ContentArea `[AllowedTypes]`, or `[ScaffoldColumn]` metadata. Every integer field is int-backed; if CMS edit mode presents it as a selection or enum, confirm the legal values in CMS edit mode instead of guessing. `editorHint` is reported verbatim from the export and is site-specific, so do not infer global semantics from a hint string.

## Generator limitations

Do not promise these. Say so early when a scenario depends on one:

| Limitation | What to do |
|---|---|
| SVG, PDF, and video media | Not generated. The generator writes PNG only. A case that turns on a PDF download, SVG rendering, or video poster needs an uploaded file supplied outside this package. |
| Inline block properties, where a property type is itself a block rather than a block placed in a ContentArea | Supported: fill with an object (Value kind) or an array of objects (List kind). The skeleton shows which. See below. |
| Selection enum labels and values | Not present in the export. Integer fields may be backed by CMS selections, but legal labels and values must be confirmed in CMS edit mode. |
| ContentArea `[AllowedTypes]` | Not present in the export. The `<availablecontenttypes>` data exposed by the tool is page-tree child availability only. |
| `[ScaffoldColumn]` | Not present in the export, so the generator cannot know whether a model property was scaffold-hidden by code. |
| Unpublished content | Everything imports as published. Passing `published: false` only produces a warning. |
| More than one language branch per package | One branch is created per package, `en` by default unless `language` is set. |
| `Category` and untyped `Json` values | Left empty. |

Working capabilities include pages, blocks, nested page trees, raster image media, text, HTML, ContentArea, content references, content reference lists, inline block properties, link collections, URLs, booleans, numbers, and `{{date:±Nd}}` / `{{date:±Nh}}` / `{{date:±Nm}}` tokens for dates relative to build time.

## Inline block properties

**An inline block property takes the block's own properties.** A property whose type *is* a block — as opposed to a block placed in a ContentArea — is filled with that block type's properties: `"Banner": { "Message": "Scheduled maintenance" }` when it holds one block, or an array of such objects when it holds a list. Keep every child field the skeleton gives you, then run `validate_plan` before removing any child fields so it can tell you which required ones must stay; the rest are written empty, exactly as the CMS writes an untouched field.

A block property either holds one block or a list of them, and `describe_content_type`'s skeleton shows which: an object means one block, an array means a list. Supply the shape the skeleton shows — an array where one block is expected, or an object where a list is expected, is an error naming the shape it wanted.

## Images

A media item is an ordinary plan item whose content type is one the site declares as media. Give it an optional size and the generator writes a placeholder PNG into the package:

```json
{
  "key": "hero",
  "type": "ImageFile",
  "name": "Scenario hero 16:9",
  "image": { "width": 1600, "height": 900 }
}
```

Other items point at it the same way they point at anything else: `{ "ref": "hero" }` for a content reference, or `[{ "ref": "hero" }]` for a ContentArea. Nothing about referencing is media-specific.

**Referencing a media item is free; `count` is not.** One media item referenced by twenty pages is one item and one file in the CMS. `count: 20` on the media item is twenty images with twenty binaries. Reach for `count` only when the case needs images it can tell apart. The generator rejects a plan that expands beyond `{{MAX_PLAN_ITEMS}}` items, an image dimension above `{{MAX_IMAGE_DIMENSION}}` pixels, or total image pixels above `{{MAX_IMAGE_PIXELS}}`; the error names the limit and the plan's own total.

**State the size when the case turns on it.** The default is `{{DEFAULT_IMAGE_WIDTH}}×{{DEFAULT_IMAGE_HEIGHT}}`, and a lone `width` or `height` is used for both axes, producing a square. Content-type exports carry no dimension metadata, so the generator cannot infer that a property wants a square avatar or a portrait card, and neither can you from the property name. A case about cropping, aspect ratio, or a responsive breakpoint has to name the pixels; a case that just needs an image present should take the default.

**The placeholder is a diagnostic pattern.** It carries a circle, a square grid, corner brackets, a center cross, and its own size printed on it. A flat color cannot show the failure: squash a flat image into the wrong aspect ratio and it still looks like itself. Under distortion the circle becomes an ellipse and grid cells become rectangles; under a crop the corner brackets go missing; a wrong rendition disagrees with the size printed on the image.

**The bytes are always PNG**, whatever the item is named. When the generator derives a media URL segment from the name, the derived URL segment uses `.png`; a supplied `urlSegment` is used as given. Naming an item `banner.jpg` earns a warning and still produces a PNG; writing PNG bytes into a `.jpg` file would look right and be wrong.

**Media lands in the site's global assets folder**, not where the importer points the package and not in the plan's block folder. Give media recognizable names so it can be found and deleted.

**Thumbnails are the CMS's job.** The package deliberately carries no thumbnail. The CMS generates the thumbnail from the image binary when the thumbnail field is empty; shipping a placeholder thumbnail would make that field non-empty and suppress generation permanently.

**A media type must be able to hold a PNG, or the plan is rejected.** A declared `supportedMediaExtensions` list decides by `png` membership: without `png` is an error, with `png` is accepted. Base is consulted only when no list is declared. A `Video` base is an error only when no list is declared; an `Image` base is accepted. A generic `Media` base builds with a warning: it is common in real exports and the export cannot prove either way, but the CMS only auto-generates thumbnails for image types, so such an item may keep a generic icon. Prefer an `Image`-based type when the site has one. `load_schema` and `describe_content_type` both list which media types are image-capable and which will be rejected, so read that rather than guessing from the name.

## Red flags

| Thought | Reality |
|---|---|
| "I'll ask for real content so I have examples." | You need type definitions, not customer data. Ask for content types only. |
| "The site must have an ArticlePage." | Read `list_content_types`. A wrong type generates content that tests nothing. |
| "The unproven warning means something failed." | It means the generator refused to guess. Report the empty fields; do not retry. |
| "This int looks like an enum, so I'll try likely numbers." | The export has no enum labels. Confirm legal values in CMS edit mode. |
| "Page-tree child availability tells me which blocks a ContentArea allows." | It does not. ContentArea `[AllowedTypes]` is absent from the export. |
| "I'll skip `validate_plan`; `build_package` validates anyway." | It does, but validating first tells you what to fix without producing a file you then discard. |
| "I'll tell the importer where the pages will appear." | The importer picks the destination for pages. Blocks go to the plan's folder and media to global assets; say those, since that is where they are cleaned up. |
| "Twenty pages need a hero, so I'll generate twenty images." | One image referenced twenty times is one item and one file. Generate several only when the case has to tell them apart. |
| "The property is called `HeroImage`, so it must want a specific aspect ratio." | The export carries no dimension metadata and the name is not evidence. Take the default, or ask what the case needs. |
| "The thumbnail is missing after import, so the package is broken." | The package leaves it empty on purpose so the CMS can generate it. |
| "Same scenario again, so I'll change the `planId` to be safe." | Reusing it updates in place, which is what you want while iterating. Change it only for a genuinely separate set. |
| "The importer can choose any destination each time." | The first import, yes. A later import with the same `planId` to a different destination moves the existing pages there instead of copying them. |
| "The update-existing checkbox is off, so this import will create a fresh set." | It will not. The package preserves identity either way; use a new `planId` or new item keys for a fresh set. |
| "One page per group of blocks keeps the tree tidy." | It multiplies the tree and the cleanup without adding coverage. Put the variants in one page's ContentArea unless the case needs them apart. |
| "The ticket is about the hero, but I'll fill the rest of the page so it looks real." | Content the case does not check is noise a reviewer has to triage. Build the case, not the page. |
