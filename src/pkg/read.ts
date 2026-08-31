import AdmZip from "adm-zip";

export type PackageParts = Map<string, Buffer>;

/** Reads every entry into memory. Never extracts to disk: entry names contain ':' and '//'. */
export function readPackage(path: string): PackageParts {
  const zip = new AdmZip(path);
  const parts: PackageParts = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    parts.set(entry.entryName, entry.getData());
  }
  return parts;
}

export function writePackage(parts: PackageParts, outPath: string): void {
  const zip = new AdmZip();
  let index = 0;
  for (const [name, data] of parts) {
    // Add with a placeholder name that adm-zip won't mangle
    zip.addFile(`_${index}`, data);
    // Safe to index directly: adm-zip appends entries during construction and only sorts at write time.
    // Directly set the true entry name on the added entry, bypassing adm-zip's path normalization.
    zip.getEntries()[index]!.entryName = name;
    index++;
  }
  zip.writeZip(outPath);
}
