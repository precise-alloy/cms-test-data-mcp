export type ValueKind =
  | "text" | "html" | "bool" | "int" | "float" | "date"
  | "contentRef" | "contentRefList" | "contentArea" | "linkCollection"
  | "url" | "stringList" | "block"
  | "unproven";

export type VocabEntry = {
  /** `${type}|${typeName ?? ""}` */
  key: string;
  type: string;
  typeName?: string;
  /**
   * Observed RawProperty shapes for this pair, keyed by shape number.
   * A pair is not guaranteed to have one shape: `Boolean|` covers both ordinary
   * booleans (shape 1) and `EPi:SystemReference` (shape 4), and several
   * PropertyBlock pairs appear as both shape 2 and shape 3. Recording the
   * distribution keeps that visible instead of letting fixture order decide.
   */
  shapes: Record<string, number>;
  occurrences: number;
  nonEmptySamples: number;
  fixtures: string[];
  valueKind: ValueKind;
  /** Up to three real values, used as expected data in serializer tests. */
  samples: string[];
};

export type Vocabulary = {
  generatedAt: string;
  fixtures: string[];
  entries: Record<string, VocabEntry>;
};
