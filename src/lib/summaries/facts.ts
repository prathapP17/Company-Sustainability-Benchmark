/**
 * The facts an AI summary may use: the company's curated values, targets and
 * SBTi status, each with an id (F1, F2, …), its fiscal-year label, boundary
 * and source. Year-on-year changes are pre-computed here (labelled derived)
 * so the model never does arithmetic. Built from the validated company file,
 * so the facts are exactly what the company page shows.
 */
import { createHash } from "node:crypto";
import type { CompanyFile } from "../schema/company";
import { resolveMetric, type ResolvedMetric } from "../schema/validate";
import { METRICS, metricAppliesTo } from "../metrics/dictionary";
import { fiscalLabel } from "../fiscal";
import { classify } from "../industry";
import { formatNumber } from "../format";
import { LABELS } from "../labels";
import type { SbtiEntry } from "../sbti/load";

export interface Fact {
  id: string;
  kind: "value" | "change" | "gap" | "target" | "sbti";
  text: string;
  /** Where a reader can check it. */
  sourceId: string | null;
  page: string | null;
  url: string | null;
}

const VALIDATION: Record<string, string> = { sbti_validated: "company states SBTi validation", self_declared: "self-declared", not_stated: "validation not stated" };
const fmt = (v: number | undefined, unit?: string) => (v === undefined ? "" : `${formatNumber(v)}${unit ? ` ${unit}` : ""}`);

export function buildFacts(company: CompanyFile, sbti: SbtiEntry): Fact[] {
  const facts: Fact[] = [];
  const add = (f: Omit<Fact, "id">) => facts.push({ ...f, id: `F${facts.length + 1}` });
  const fy = company.profile.fiscalYear;
  const src = (id?: string) => company.sources.find((s) => s.id === id);
  const metrics = METRICS.filter((m) => metricAppliesTo(m, classify(company.profile.industry).codes) && !/^ghg_scope3_c/.test(m.id));

  for (const def of metrics) {
    const entries = company.metrics.filter((m) => m.metric === def.id).map((m) => resolveMetric(company, m));
    if (!entries.length) continue;
    // Latest year; prefer the consolidated group within a year.
    const latestYear = Math.max(...entries.map((e) => e.year));
    const inYear = entries.filter((e) => e.year === latestYear);
    const latest = inYear.find((e) => e.boundary === "consolidated_group") ?? inYear[0];
    const label = fiscalLabel(fy, latest.year);
    const s = src(latest.source);
    if (latest.state !== "disclosed") {
      add({ kind: "gap", text: `${def.label}: ${LABELS.state[latest.state].toLowerCase()} (${label})`, sourceId: latest.source ?? null, page: latest.page ?? null, url: s?.url ?? null });
      continue;
    }
    const ctx = [
      LABELS.boundary[latest.boundary].toLowerCase(),
      latest.scope2Method ? `${latest.scope2Method}-based` : null,
      latest.coverage ? `coverage: ${latest.coverage}` : null,
      latest.status === "derived" ? "derived value" : null,
    ].filter(Boolean);
    add({
      kind: "value",
      text: `${def.label}, ${label}: ${latest.value !== undefined ? fmt(latest.value, latest.unit) : (latest.text ?? "")} (${ctx.join("; ")})`,
      sourceId: latest.source ?? null,
      page: latest.page ?? null,
      url: s?.url ?? null,
    });
    // Change versus the prior year: same boundary, method and unit, no trend break (rule 4).
    const prev = entries.find(
      (e: ResolvedMetric) =>
        e.year === latest.year - 1 && e.state === "disclosed" && e.boundary === latest.boundary && e.scope2Method === latest.scope2Method && e.unit === latest.unit,
    );
    if (prev && prev.value !== undefined && latest.value !== undefined && prev.value !== 0 && !latest.trendBreak && def.canonicalUnit !== "%") {
      const pct = Math.round(((latest.value - prev.value) / Math.abs(prev.value)) * 1000) / 10;
      add({
        kind: "change",
        text: `${def.label}: ${fmt(latest.value, latest.unit)} in ${label} versus ${fmt(prev.value, prev.unit)} in ${fiscalLabel(fy, prev.year)}, a change of ${pct > 0 ? "+" : ""}${pct}% (derived)`,
        sourceId: latest.source ?? null,
        page: latest.page ?? null,
        url: s?.url ?? null,
      });
    }
  }

  for (const t of company.targets) {
    const parts = [t.description, `target year ${t.target.year}`];
    if (t.baseline?.year) parts.push(`base year ${t.baseline.year}`);
    if (t.latest?.value !== undefined) parts.push(`latest progress ${fmt(t.latest.value, t.latest.unit)} in ${t.latest.year}`);
    parts.push(VALIDATION[t.validation]);
    add({ kind: "target", text: `Target: ${parts.join("; ")}`, sourceId: t.source, page: t.page, url: src(t.source)?.url ?? null });
  }

  if (sbti.kind === "found") {
    const c = sbti.company;
    add({
      kind: "sbti",
      text: `SBTi Target Dashboard: near-term ${c.nearTerm.status ?? "none"}${c.nearTerm.classification ? ` (${c.nearTerm.classification})` : ""}; net-zero ${c.netZero.status ?? "none"}${c.netZero.year ? ` (${c.netZero.year})` : ""}`,
      sourceId: "SBTi Target Dashboard",
      page: null,
      url: "https://sciencebasedtargets.org/target-dashboard",
    });
  } else if (sbti.kind === "not_found") {
    add({ kind: "sbti", text: "SBTi Target Dashboard: company not listed", sourceId: "SBTi Target Dashboard", page: null, url: "https://sciencebasedtargets.org/target-dashboard" });
  }
  return facts;
}

/** Identifies the facts a summary was written from; a different hash means the data changed since. */
export const factsHash = (facts: Fact[]) => createHash("sha256").update(JSON.stringify(facts.map((f) => [f.id, f.text]))).digest("hex");
