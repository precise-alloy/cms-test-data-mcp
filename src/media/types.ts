/** One binary in the package, with every string form the format needs. */
export type MediaBlob = {
  /**
   * Zip entry name, with a leading slash and a doubled inner slash. The importer
   * builds its part URI as "/" + providerName + "/" + providerRelativePath, and
   * providerName already ends in a slash. The leading slash is stripped when the
   * entry is added to the zip.
   */
  entryName: string;
  /** Value written into the BinaryData property. Single slash. */
  url: string;
  /** ~/link/{contentGuid}.{ext} - seeds the importer's GUID-to-link map. */
  permanentLinkVirtualPath: string;
  providerName: string;
  providerRelativePath: string;
  /** Lower case, no leading dot. */
  extension: string;
  bytes: Buffer;
};
