import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { CHECKLIST_LABELS } from "@/lib/scoring/transparency";
import { INDICATOR_LABELS, MIN_INDICATORS, PATHWAY_ANNUAL_REDUCTION } from "@/lib/scoring/performance";
import { COVERAGE_THRESHOLD } from "@/lib/data/coverage";
import { MIN_PEERS_FOR_MEDIAN } from "@/lib/scoring/peer";

export const metadata: Metadata = { title: "Methodology" };

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 mb-1 text-sm font-semibold text-ink first:mt-0">{children}</h3>;
}

export default function MethodologyPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Methodology</h1>
        <p className="mt-1 text-sm text-ink-2">How values are collected, compared and scored.</p>
      </div>

      <Card title="Data rules">
        <div className="text-sm text-ink-2">
          <H>Every number traces to a source</H>
          <p>Each value records the document, page (or cell or section), reported wording, boundary, consolidation approach, Scope 2 method, assurance and verification class. Ambiguous values are not recorded; they are logged as data gaps.</p>
          <H>Missing is not zero</H>
          <p>Disclosed: evidence found. Not disclosed: the company explicitly omits it. Not found: researched in full, absent. Not assessed: not researched enough to conclude.</p>
          <H>Comparability</H>
          <p>Values on different boundaries (consolidated group, parent only, subsidiary), Scope 2 methods or partial operational coverage are shown side by side with a warning and are never added, averaged or ranked together. Values that cannot be compared with the prior year because a method, emission factor or scope changed carry a trend-break flag. Derived values are simple arithmetic on reported values, with the method written next to them.</p>
          <H>Fiscal years</H>
          <p>Each value keeps the company&apos;s own fiscal-year label. Japanese companies label by start year (FY2025 ends March 2026); Indian and US companies by end year.</p>
        </div>
      </Card>

      <Card title="Transparency score">
        <div className="text-sm text-ink-2">
          <p>
            Share of applicable checklist items met, 0-100. Items that cannot be assessed (for example when an assurance
            statement could not be read) are excluded from the denominator. The score is withheld when fewer than{" "}
            {Math.round(COVERAGE_THRESHOLD * 100)}% of core metrics have been assessed.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {CHECKLIST_LABELS.map((x) => (
              <li key={x.id}>{x.label}</li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="Performance score">
        <div className="text-sm text-ink-2">
          <p>
            Mean of the available indicator scores (0-100), shown only when at least {MIN_INDICATORS} of 5 indicators can be
            computed. Indicators use only values on a consolidated-group boundary with full coverage and no low-confidence
            source. Revenue-based intensity is not yet included (needs revenue data).
          </p>
          <ul className="mt-2 list-disc pl-5">
            <li>
              <b>{INDICATOR_LABELS.ghg_target_progress}</b>: for absolute GHG targets where the company reports progress as a
              % reduction, achieved share ÷ share expected on a straight line from baseline to target year, capped at 100.
            </li>
            <li>
              <b>{INDICATOR_LABELS.ghg_s12_yoy}</b> and <b>{INDICATOR_LABELS.water_yoy}</b>: change between the latest two
              years. A reduction of {PATHWAY_ANNUAL_REDUCTION}% or more (the annual pace of a 1.5°C absolute-contraction
              pathway) scores 100; no change scores 50; an increase of 10% or more scores 0; linear in between. Skipped
              when either year has a trend break.
            </li>
            <li>
              <b>{INDICATOR_LABELS.renewable_share}</b> and <b>{INDICATOR_LABELS.waste_diversion}</b>: the reported
              percentage. Company definitions differ (for example whether unbundled certificates count); see each value&apos;s
              note.
            </li>
          </ul>
        </div>
      </Card>

      <Card title="Peer benchmarks">
        <p className="text-sm text-ink-2">
          Peer groups follow industry (SASB). A peer median is shown only when at least {MIN_PEERS_FOR_MEDIAN} peers report
          a comparable value in the same unit. Peer ranks are shown only within groups with two or more scored companies.
        </p>
      </Card>

      <Card title="Exports">
        <p className="text-sm text-ink-2">
          CSV, XLSX and PDF exports carry the full provenance of every value (source, page, boundary, method, assurance,
          verification class). Reviewer-only internal notes are never exported.
        </p>
      </Card>
    </div>
  );
}
