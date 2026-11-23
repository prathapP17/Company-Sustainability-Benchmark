import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, StateBadge, Tag } from "@/components/ui";
import { CoverageBar, CoverageLegend } from "@/components/CoverageBar";
import { ContextTags } from "@/components/ContextTags";
import { Scope3Chart, type Scope3Datum } from "@/components/Scope3Chart";
import { ScoreBar } from "@/components/ScoreBar";
import { TargetProgressBar } from "@/components/TargetProgressBar";
import { progressFromRow } from "@/lib/scoring/targets";
import {
  dataGapsFor,
  getCompany,
  listCompanyIds,
  metricValuesFor,
  reportsFor,
  scoreFor,
  allIndicators,
  allTransparencyItems,
  sourcesFor,
  targetsFor,
  type MetricValueRow,
  type SourceRow,
} from "@/lib/db/queries";
import { METRICS, metricAppliesTo, type MetricCategory, type MetricDef } from "@/lib/metrics/dictionary";
import { LABELS, type AssuranceLevel, type Boundary, type Consolidation, type VerificationClass } from "@/lib/schema/enums";
import { fiscalLabel } from "@/lib/fiscal";
import { formatCompact, formatReported, titleCase } from "@/lib/format";

export function generateStaticParams() {
  return listCompanyIds().map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/companies/[id]">): Promise<Metadata> {
  const { id } = await params;
  const c = getCompany(id);
  return { title: c ? c.name : "Company not found" };
}

const CATEGORY_LABEL: Record<MetricCategory, string> = {
  emissions: "Emissions",
  energy: "Energy",
  water: "Water",
  waste: "Waste",
  materials: "Materials",
  industry: "Industry-specific (SASB)",
};

function SourceRef({ v, sources }: { v: MetricValueRow; sources: Map<string, SourceRow> }) {
  const s = v.source_id ? sources.get(v.source_id) : undefined;
  if (!s) return null;
  return (
    <a href={s.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
      {s.id}
      {v.page ? `, ${v.page}` : ""}
    </a>
  );
}

function ValueDetails({ v, sources }: { v: MetricValueRow; sources: Map<string, SourceRow> }) {
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs text-ink-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <SourceRef v={v} sources={sources} />
        {v.state === "disclosed" && (
          <span>
            {LABELS.boundary[v.boundary as Boundary]} · {LABELS.consolidation[v.consolidation as Consolidation]} ·
            Assurance: {LABELS.assurance[v.assurance_level as AssuranceLevel]}
            {v.assurance_provider ? ` (${v.assurance_provider})` : ""} ·{" "}
            {LABELS.verification[v.verification_class as VerificationClass]}
          </span>
        )}
      </div>
      {v.reported_wording && <div className="italic">“{v.reported_wording}”</div>}
      {v.note && <div>{v.note}</div>}
    </div>
  );
}

function MetricRow({
  def,
  entries,
  sources,
  fy,
}: {
  def: MetricDef;
  entries: MetricValueRow[];
  sources: Map<string, SourceRow>;
  fy: { end: string; labelConvention: "end_year" | "start_year" };
}) {
  const latest = entries[0];
  const previous = entries.slice(1);
  return (
    <li className="border-b border-hairline py-3 last:border-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{def.label}</div>
          {def.sasb && <div className="text-xs text-ink-muted">SASB {def.sasb}</div>}
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {latest ? (
            latest.state === "disclosed" ? (
              <>
                <div className="tabular text-sm text-ink">
                  {formatReported(latest.value, latest.unit, latest.text)}{" "}
                  <span className="text-ink-muted">· {fiscalLabel(fy, latest.year)}</span>
                </div>
                <ContextTags v={latest} />
              </>
            ) : (
              <div className="flex items-center gap-2">
                <StateBadge state={latest.state} />
                <span className="text-xs text-ink-muted">{fiscalLabel(fy, latest.year)}</span>
              </div>
            )
          ) : (
            <StateBadge state="not_assessed" />
          )}
        </div>
      </div>
      {latest && <ValueDetails v={latest} sources={sources} />}
      {previous.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-ink-2">Earlier years ({previous.length})</summary>
          <ul className="mt-1 flex flex-col gap-2 pl-3">
            {previous.map((p) => (
              <li key={p.id}>
                <span className="tabular text-ink">
                  {fiscalLabel(fy, p.year)}: {p.state === "disclosed" ? formatReported(p.value, p.unit, p.text) : LABELS.state[p.state]}
                </span>{" "}
                <ContextTags v={p} compact />
                <ValueDetails v={p} sources={sources} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const c = getCompany(id);
  if (!c) notFound();

  const values = metricValuesFor(id);
  const sources = sourcesFor(id);
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const reports = reportsFor(id);
  const targets = targetsFor(id);
  const gaps = dataGapsFor(id);
  const score = scoreFor(id);
  const indicators = allIndicators().filter((i) => i.company_id === id);
  const missedItems = allTransparencyItems().filter((i) => i.company_id === id && i.met === 0);
  const listings = JSON.parse(c.listings) as { exchange: string; ticker: string }[];
  const frameworks = JSON.parse(c.frameworks) as { name: string; detail?: string }[];
  const notes = JSON.parse(c.comparability_notes) as string[];
  const fy = { end: c.fy_end, labelConvention: c.fy_label_convention };

  const byMetric = new Map<string, MetricValueRow[]>();
  for (const v of values) {
    if (!byMetric.has(v.metric_id)) byMetric.set(v.metric_id, []);
    byMetric.get(v.metric_id)!.push(v);
  }
  const applicable = METRICS.filter((m) => metricAppliesTo(m, c.peer_group) && !m.id.startsWith("ghg_scope3_c"));
  const categories = [...new Set(applicable.map((m) => m.category))];

  const scope3: Scope3Datum[] = METRICS.filter((m) => m.id.startsWith("ghg_scope3_c"))
    .map((m) => {
      const v = byMetric.get(m.id)?.find((x) => x.year === c.cov_year && x.state === "disclosed" && x.canonical_value !== null);
      if (!v) return null;
      return {
        category: Number(m.id.replace("ghg_scope3_c", "")),
        label: m.label.replace(/^Scope 3 cat\. \d+: /, ""),
        value: v.canonical_value!,
        derived: v.status === "derived",
      };
    })
    .filter((x): x is Scope3Datum => x !== null);
  const scope3Total = byMetric.get("ghg_scope3_total")?.find((v) => v.year === c.cov_year && v.state === "disclosed");

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/" className="hover:underline">
          Dashboard
        </Link>{" "}
        / {c.name}
      </nav>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-ink">{c.name}</h1>
        <div className="text-sm text-ink-2">
          {c.legal_name} · {listings.map((l) => `${l.exchange}: ${l.ticker}`).join(" · ")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>{c.peer_group_name}</Tag>
          <Tag>{c.sasb}</Tag>
          <Tag>
            {c.city}, {c.country}
          </Tag>
          {c.research_status === "detailed" ? <Tag>Researched in detail</Tag> : <Tag tone="warn">{titleCase(c.research_status)}</Tag>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>
            Fiscal year ends {c.fy_end.split("-").reverse().join("/")} ·{" "}
            {c.fy_label_convention === "start_year" ? "labelled by start year" : "labelled by end year"}
          </span>
          <span>Last reviewed {c.last_reviewed}</span>
          <a href={c.website} className="text-accent hover:underline" target="_blank" rel="noreferrer">
            Website
          </a>
          {c.sustainability_page && (
            <a href={c.sustainability_page} className="text-accent hover:underline" target="_blank" rel="noreferrer">
              Sustainability page
            </a>
          )}
        </div>
        {c.fy_note && <p className="text-xs text-ink-muted">{c.fy_note}</p>}
        {c.research_notes && <p className="max-w-3xl text-sm text-ink-2">{c.research_notes}</p>}
      </div>

      <Card title="Core metric coverage" action={<CoverageLegend />}>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <CoverageBar
              label={`${c.name} coverage`}
              total={c.cov_total}
              counts={{
                disclosed: c.cov_disclosed,
                not_disclosed: c.cov_not_disclosed,
                not_found: c.cov_not_found,
                not_assessed: c.cov_not_assessed,
              }}
            />
          </div>
          <span className="tabular text-sm text-ink-2">
            {c.cov_disclosed}/{c.cov_total} disclosed
            {c.cov_year ? ` · ${fiscalLabel(fy, c.cov_year)}` : ""}
          </span>
        </div>
      </Card>

      <Card title="Scores" action={<Link href="/methodology" className="text-xs text-accent hover:underline">How scores work</Link>}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-ink">Transparency</div>
            <ScoreBar value={score?.transparency_score ?? null} label="Transparency score" />
            <div className="mt-1 text-xs text-ink-muted">
              {score?.transparency_reason ?? `${score?.transparency_met} of ${score?.transparency_applicable} checklist items met`}
            </div>
            {missedItems.length > 0 && score?.transparency_score !== null && (
              <ul className="mt-2 list-disc pl-5 text-xs text-ink-2">
                {missedItems.map((i) => (
                  <li key={i.item_id}>
                    Not met: {i.label}
                    {i.evidence ? <span className="text-ink-muted"> ({i.evidence})</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-ink">Performance</div>
            <ScoreBar value={score?.performance_score ?? null} label="Performance score" />
            {score?.performance_reason && <div className="mt-1 text-xs text-ink-muted">{score.performance_reason}</div>}
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {indicators.map((i) => (
                <li key={i.indicator_id} className="flex justify-between gap-3">
                  <span className="text-ink-2">{i.label}</span>
                  <span className="tabular shrink-0 text-right text-ink-muted" title={i.detail ?? ""}>
                    {i.score !== null ? `${Math.round(i.score)} (${i.raw_value}${i.raw_unit?.startsWith("%") ? "%" : ""})` : "–"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {notes.length > 0 && (
        <div className="rounded-xl border border-hairline bg-warn-bg p-4 text-sm text-warn-ink">
          <div className="mb-1 font-medium">
            <span aria-hidden>⚠ </span>Comparability notes
          </div>
          <ul className="list-disc pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          {categories.map((cat) => (
            <Card key={cat} title={CATEGORY_LABEL[cat]}>
              <ul>
                {applicable
                  .filter((m) => m.category === cat)
                  .map((m) => (
                    <MetricRow key={m.id} def={m} entries={byMetric.get(m.id) ?? []} sources={sourceMap} fy={fy} />
                  ))}
              </ul>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-6">
          {scope3.length >= 2 && (
            <Card title={`Scope 3 by category, ${c.cov_year ? fiscalLabel(fy, c.cov_year) : ""}`}>
              <p className="mb-2 text-xs text-ink-muted">
                tCO2e, as reported. Categories reported only in combined lines are omitted (see data gaps).
                {scope3Total ? ` Scope 3 total: ${formatCompact(scope3Total.canonical_value, scope3Total.canonical_unit)}.` : ""}
              </p>
              <Scope3Chart data={scope3} companyName={c.name} />
            </Card>
          )}

          <Card title="Targets">
            {targets.length === 0 ? (
              <p className="text-sm text-ink-muted">Not assessed.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {targets.map((t) => (
                  <li key={t.id} className="border-b border-hairline pb-3 text-sm last:border-0 last:pb-0">
                    <div className="text-ink">{t.description}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Tag>{titleCase(t.type)}</Tag>
                      {t.scopes && <Tag>Scopes {(JSON.parse(t.scopes) as string[]).join(", ")}</Tag>}
                      <Tag tone={t.validation === "sbti_validated" ? "neutral" : "warn"}>
                        {t.validation === "sbti_validated" ? "SBTi validated" : t.validation === "self_declared" ? "Self-declared" : "Validation not stated"}
                      </Tag>
                    </div>
                    <div className="mt-2">
                      <TargetProgressBar p={progressFromRow(t)} />
                    </div>
                    <div className="tabular mt-1 text-xs text-ink-muted">
                      {t.baseline_year ? `Baseline ${t.baseline_year}${t.baseline_value !== null ? `: ${t.baseline_value} ${t.baseline_unit ?? ""}` : ""} · ` : ""}
                      Target {t.target_year}
                      {t.target_value !== null ? `: ${t.target_value} ${t.target_unit ?? ""}` : ""}
                      {t.latest_year ? ` · Latest ${t.latest_year}: ${t.latest_value} ${t.latest_unit ?? ""}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted">
                      {sourceMap.get(t.source_id) ? (
                        <a href={sourceMap.get(t.source_id)!.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                          {t.source_id}, {t.page}
                        </a>
                      ) : (
                        `${t.source_id}, ${t.page}`
                      )}
                      {t.note ? ` · ${t.note}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Sources and assurance">
            <ul className="flex flex-col gap-3 text-sm">
              {sources.map((s) => (
                <li key={s.id}>
                  <a href={s.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <div className="text-xs text-ink-muted">
                    {s.id} · {s.organisation} · {LABELS.verification[s.verification_class as VerificationClass]} · accessed{" "}
                    {s.accessed}
                  </div>
                  {s.notes && <div className="text-xs text-ink-muted">{s.notes}</div>}
                </li>
              ))}
            </ul>
            {reports.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3 text-xs text-ink-2">
                {reports.map((r) => (
                  <li key={`${r.year}-${r.type}`}>
                    {fiscalLabel(fy, r.year)} {titleCase(r.type)}: {LABELS.assurance[r.assurance_level as AssuranceLevel]} assurance
                    {r.assurance_provider ? ` by ${r.assurance_provider}` : ""}
                    {r.assurance_scope ? ` (${r.assurance_scope})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {frameworks.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1 border-t border-hairline pt-3">
                {frameworks.map((f) => (
                  <Tag key={f.name} title={f.detail}>
                    {f.name}
                  </Tag>
                ))}
              </div>
            )}
          </Card>

          <Card title="Data gaps">
            {gaps.length === 0 ? (
              <p className="text-sm text-ink-muted">None logged.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {gaps.map((g, i) => (
                  <li key={i}>
                    <Tag tone="warn">{titleCase(g.kind)}</Tag>{" "}
                    <span className="text-ink-2">{g.description}</span>
                    {(g.source_id || g.page) && (
                      <span className="text-xs text-ink-muted">
                        {" "}
                        ({[g.source_id, g.page].filter(Boolean).join(", ")})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
