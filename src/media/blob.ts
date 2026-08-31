import { guidNoDashes } from "../values/serialize";
import type { MediaBlob } from "./types";

export * from "./types";

const BLOB_SCHEME = "epi.fx.blob";
const DEFAULT_PROVIDER = "default";

/**
 * Only the extensions a generated package can contain. Anything else resolves to
 * octet-stream, which is what the CMS's own resolver returns for an unregistered
 * extension - real exports declare .webp that way.
 */
const MIME_TYPES: Record<string, string> = {
  xml: "text/xml",
  png: "image/png",
};

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, "").toLowerCase();
}

export function mimeTypeFor(extension: string): string {
  return MIME_TYPES[normalizeExtension(extension)] ?? "application/octet-stream";
}

export function makeMediaBlob(
  contentGuid: string,
  blobGuid: string,
  extension: string,
  bytes: Buffer
): MediaBlob {
  const container = guidNoDashes(contentGuid);
  const ext = normalizeExtension(extension);
  const fileName = `${guidNoDashes(blobGuid)}.${ext}`;
  const providerName = `${BLOB_SCHEME}://${DEFAULT_PROVIDER}/${container}/`;

  return {
    entryName: `/${providerName}/${fileName}`,
    url: `${BLOB_SCHEME}://${DEFAULT_PROVIDER}/${container}/${fileName}`,
    permanentLinkVirtualPath: `~/link/${container}.${ext}`,
    providerName,
    providerRelativePath: fileName,
    extension: ext,
    bytes,
  };
}
