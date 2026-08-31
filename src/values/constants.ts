/** The zero GUID used for idmap entries and as the default content assets ID. */
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** Marker class id used by every ContentArea item. Not a content-type GUID. */
export const CONTENT_AREA_CLASS_ID = "36f4349b-8093-492b-b616-05d8964e4c89";

export const EXPORT_CULTURE = "en-US";
export const EXPORT_VERSION = "4";
/** Pins human-readable number diagnostics; deliberately separate from the .episerverdata export culture. */
export const DIAGNOSTIC_LOCALE = "en-US";

export const SYSTEM_ROOTS = {
  rootPage: {
    guid: "43f936c9-9b23-4ea3-97b2-61c538ad07c9",
    reference: "EPi:RootPage",
    universal: true,
  },
  globalResources: {
    guid: "e56f85d0-e833-4e02-976a-2d11fe4d598c",
    reference: "EPi:GlobalResourcesRoot",
    universal: true,
  },
  contentResources: {
    guid: "99d57529-61f2-47c0-80c0-f91eca6af1ac",
    reference: "EPi:ContentResourcesRoot",
    universal: false,
  },
  siteResources: {
    guid: "dcaa593c-99c1-45f0-aa50-4a824beaf730",
    reference: "EPi:SiteResourcesRoot",
    universal: false,
  },
} as const;

/**
 * The 37 system property names. Closed set: unchanged across all five content
 * fixtures (~210,000 properties). A new name here means the design assumption
 * that this set is closed is wrong.
 */
export const SYSTEM_PROPERTY_NAMES: readonly string[] = [
  "PageGUID", "PageLink", "PageParentLink", "PageName", "PageTypeID", "PageTypeName",
  "PageURLSegment", "PageSaved", "PageChanged", "PageCreated", "PageCreatedBy",
  "PageChangedBy", "PageChangedOnPublish", "PageDeleted", "PageDeletedBy",
  "PageDeletedDate", "PageWorkStatus", "PagePendingPublish", "PageStartPublish",
  "PageStopPublish", "PageCategory", "PageMasterLanguageBranch", "PageLanguageBranch",
  "PageContentAssetsID", "PageVisibleInMenu", "PageContentOwnerID", "PageArchiveLink",
  "PageChildOrderRule", "PageExternalURL", "PageLinkURL", "PagePeerOrder",
  "PageShortcutLink", "PageShortcutType", "PageTargetFrame", "BinaryData",
  "Thumbnail", "EPi:SystemReference",
];

/** VersionStatus value meaning Published. */
export const WORK_STATUS_PUBLISHED = "4";

/**
 * Import fails with InvalidOperationException when a url segment is one of these.
 * The CMS compares them case-insensitively.
 */
export const RESERVED_URL_SEGMENTS: ReadonlySet<string> = new Set([
  "contentassets",
  "siteassets",
  "globalassets",
]);

/**
 * How deep an inline block may nest. Real content nests one level; 12 of 54 block types
 * declare a nested block, so recursion is required, but a cap keeps a cyclic or
 * pathological schema from producing unbounded output. Shared with plan validation so the
 * limit an agent is told and the limit the builder enforces cannot differ.
 */
export const MAX_BLOCK_DEPTH = 4;
