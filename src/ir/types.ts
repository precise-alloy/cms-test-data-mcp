import type { XElement } from "../xml/types";

export type PackageIR = {
  culture: string;
  version: string;
  /** `<contentroots>` element, kept verbatim. */
  contentRoots: XElement;
  /** First `<pages>` block: the items chosen in the Export screen. */
  selected: XElement[];
  /** Second `<pages>` block: the dependency closure Optimizely pulled in. */
  closure: XElement[];
  /** `<files>` element, mirrors the body of epiMedia.xml. */
  files: XElement;
};
