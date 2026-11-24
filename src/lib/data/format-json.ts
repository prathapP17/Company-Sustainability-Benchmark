/**
 * Stable, diff-friendly formatting for curated company files: objects are
 * expanded with 2-space indentation, but each element of a list of records
 * (metrics, sources, targets, …) is written on ONE line, so an approval adds
 * exactly one line to the git diff.
 */
function inline(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `[${v.map(inline).join(", ")}]` : "[]";
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

function block(v: unknown, indent: string): string {
  const next = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    // Lists of records: one record per line. Lists of scalars: inline.
    if (v.every((x) => x && typeof x === "object")) return `[\n${v.map((x) => next + inline(x)).join(",\n")}\n${indent}]`;
    return inline(v);
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${block(x, next)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(v);
}

export function formatCompanyJson(obj: unknown): string {
  return block(obj, "") + "\n";
}
