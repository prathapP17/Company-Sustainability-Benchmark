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

      <Card title="Targets: pace check and SBTi status">
        <p className="text-sm text-ink-2">
          For absolute emissions targets stated as a percentage cut from a base year, the implied linear yearly reduction
          (cut ÷ years from base year to target year) is compared with SBTi&apos;s near-term minimums: 4.2% a year for
          1.5 °C and 2.5% a year for well-below 2 °C. This is a derived check of pace only; it ignores the coverage,
          base-year and time-frame rules that SBTi validation also applies, and intensity and net-zero targets are not
          assessed. SBTi&apos;s own status and classification come from its public Target Dashboard download, cited with its
          data date and file checksum; each company is pinned to one SBTi record (name and ISIN/LEI checked).
        </p>
      </Card>

      <Card title="Scope 3 heatmap and industry KPIs">
        <p className="text-sm text-ink-2">
          The heatmap shows each company&apos;s disclosure state per Scope 3 category in its latest year. A category&apos;s share
          of the company&apos;s own Scope 3 total is a derived figure, shown only when both have the same year and boundary,
          and is not compared across companies. Industry KPIs (SASB/ISSB) are shown only within the peer group they apply
          to, with boundary warnings.
        </p>
      </Card>

      <Card title="AI summaries">
        <p className="text-sm text-ink-2">
          Claude (claude-opus-5-5) writes a short summary from the company&apos;s curated facts only, citing a fact for every
          sentence. Decided with the project owner on 2026-11-25: summaries are published without human review, as an
          exception to the rule that automated output is a proposal, but only after an automatic check: every number must
          appear in a cited fact, and comparisons, rankings, judgements and forecasts are refused. A summary is hidden as
          soon as the company&apos;s data changes, and the values and sources on the page always take precedence.
        </p>
      </Card>

      <Card title="News and controversy signals">
        <p className="text-sm text-ink-2">
          Weekly searches of the GDELT news index (headlines and links only) for each company together with topic words
          such as pollution, lawsuit or forced labor. Every item is a secondary, unverified source: it is shown only after a
          reviewer approves it with a note on its relevance, and it never changes a value or a score.
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
