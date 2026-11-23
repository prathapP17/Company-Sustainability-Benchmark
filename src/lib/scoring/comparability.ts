/**
 * Rule 4: never add or compare values on different boundaries or methods.
 * These helpers decide how two or more values may be shown together.
 */
export interface ComparableValue {
  boundary: string;
  consolidation: string;
  scope2Method?: string | null;
  coverage?: string | null;
  canonicalUnit?: string | null;
  lowConfidence?: boolean | number | null;
}

export type ComparabilityLevel = "comparable" | "caution" | "not_comparable";

export interface ComparabilityResult {
  level: ComparabilityLevel;
  reasons: string[];
}

/** Can this single value enter a cross-company ranking or score? */
export function rankable(v: ComparableValue): { ok: boolean; reason?: string } {
  if (v.boundary !== "consolidated_group") return { ok: false, reason: `boundary is ${v.boundary.replace(/_/g, " ")}` };
  if (v.coverage) return { ok: false, reason: `partial coverage (${v.coverage})` };
  if (v.lowConfidence) return { ok: false, reason: "low-confidence source" };
  return { ok: true };
}

/** Comparability of a set of values for the same metric across companies. */
export function compareSet(values: ComparableValue[]): ComparabilityResult {
  const reasons: string[] = [];
  let level: ComparabilityLevel = "comparable";
  const distinct = <K extends keyof ComparableValue>(k: K) => new Set(values.map((v) => v[k] ?? null)).size > 1;

  if (values.some((v) => v.boundary !== "consolidated_group")) {
    level = "not_comparable";
    reasons.push("some values are not on a consolidated-group boundary");
  }
  if (values.some((v) => v.coverage)) {
    level = "not_comparable";
    reasons.push("some values cover only part of operations");
  }
  if (distinct("scope2Method")) {
    level = "not_comparable";
    reasons.push("Scope 2 methods differ");
  }
  if (distinct("canonicalUnit")) {
    level = "not_comparable";
    reasons.push("units cannot be converted to a common unit");
  }
  if (level === "comparable" && (distinct("consolidation") || values.some((v) => v.consolidation === "not_stated"))) {
    level = "caution";
    reasons.push("consolidation approaches differ or are not stated");
  }
  return { level, reasons };
}
