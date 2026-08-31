import type { ValueKind } from "../vocab/types";

export type PropertyTabInfo = { id: number; name?: string; displayName?: string; sortIndex?: number };

export type ChildAvailabilityInfo = {
  ownerContentTypeName?: string;
  ownerContentTypeId?: number;
  availability?: "All" | "None" | "Specific" | string;
  allowedTypeNames: string[];
  note: string;
};

export type ExportCapabilitySummary = {
  helpTextProperties: number;
  displayEditUIFalseProperties: number;
  existsOnModelFalseProperties: number;
  pageTreeAvailabilityEntries: number;
  pageTreeAvailabilityByStatus: Record<string, number>;
  absentMetadata: string[];
};

export type PropertyInfo = {
  id: number;
  name: string;
  tabId: number;
  dataType: string;
  typeName?: string;
  /**
   * Present only for an inline block property. The export carries this in
   * `Type/BlockType`; `name` is the key into `SchemaIndex.types`, and all three
   * fields are copied verbatim into `BlockTypeReference` when the block is written.
   */
  blockType?: { guid: string; name: string; modelTypeString: string };
  /**
   * Set only for a block property. "List" means the property holds a list of block
   * items rather than one; the export carries it as <Kind kind="..."/> beside <Type>.
   * Absent or unrecognised kinds are treated as "Value", which is the dominant form
   * (562 of 738 real block properties) and the pre-existing behaviour.
   */
  blockKind?: "Value" | "List";
  assemblyName?: string;
  required: boolean;
  languageSpecific: boolean;
  editCaption: string;
  valueKind: ValueKind;
  /** True when filling this property requires another item in the plan. */
  createsDependency: boolean;
  helpText?: string;
  displayEditUI?: boolean;
  existsOnModel?: boolean;
  hidden?: boolean;
  tab?: PropertyTabInfo;
  fieldOrder?: number;
  searchable?: boolean;
  defaultValueType?: string;
  editorHint?: string;
  saved?: string;
};

export type ContentTypeInfo = {
  id: number;
  guid: string;
  name: string;
  displayName: string;
  base: string;
  kind: "page" | "block" | "media" | "other";
  modelType?: string;
  properties: PropertyInfo[];
  description?: string;
  groupName?: string;
  isAvailable?: boolean;
  sortOrder?: number;
  supportedMediaExtensions?: string;
  versionString?: string;
  saved?: string;
  created?: string;
  childAvailability?: ChildAvailabilityInfo[];
};

export type SchemaIndex = {
  culture: string;
  version: string;
  types: Record<string, ContentTypeInfo>;
  capabilities?: ExportCapabilitySummary;
  childAvailability?: ChildAvailabilityInfo[];
};
