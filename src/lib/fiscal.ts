import type { Profile } from "./schema/company";

/**
 * ISO end date of a company's fiscal year given its own label.
 * Lesson learned: India "FY2025" ends March 2025 (end-year label);
 * Japan "FY2025" starts April 2025 and ends March 2026 (start-year label).
 */
export function periodEnd(fy: Profile["fiscalYear"], label: number): string {
  const isCalendar = fy.end === "12-31";
  const endYear = fy.labelConvention === "start_year" && !isCalendar ? label + 1 : label;
  return `${endYear}-${fy.end}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human label such as "FY2025 (to Mar 2026)" or "2025". */
export function fiscalLabel(fy: Pick<Profile["fiscalYear"], "end" | "labelConvention">, label: number): string {
  if (fy.end === "12-31") return String(label);
  const end = periodEnd(fy as Profile["fiscalYear"], label);
  const [y, m] = end.split("-");
  return `FY${label} (to ${MONTHS[Number(m) - 1]} ${y})`;
}
