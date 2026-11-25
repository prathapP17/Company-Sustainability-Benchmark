import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { RequeueButton, ReviewActions } from "@/components/review/ReviewClient";
import { hasRole } from "@/lib/auth/accounts";
import { getCompany } from "@/lib/db/queries";
import { getMetric } from "@/lib/metrics/dictionary";
import { fiscalLabel } from "@/lib/fiscal";
import { formatReported, titleCase } from "@/lib/format";
import { LABELS } from "@/lib/labels";
import type { Boundary, Consolidation } from "@/lib/schema/enums";
import { extractionsFor, getDocument, jobsFor, ocrPageNumbers, pagesFor } from "@/lib/pipeline/queries";
import { MAX_OCR_PAGES } from "@/lib/extract/ocr";
import { normalizeForMatch } from "@/lib/pipeline/evidence";
import type { Conflict } from "@/lib/pipeline/review";
import type { ExtractionRow } from "@/lib/pipeline/db";
import { currentAccess } from "../../gate";
import { Denied } from "../../Denied";

export const metadata: Metadata = { title: "Review document", robots: { index: false, follow: false } };

const GROUPS: { status: ExtractionRow["status"]; title: string }[] = [
  { status: "pending", title: "Pending review" },
  { status: "blocked", title: "Blocked: evidence not found" },
  { status: "approved", title: "Approved" },
  { status: "rejected", title: "Rejected" },
];

export default function DocumentReviewPage({ params }: PageProps<"/review/documents/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / Document
      </nav>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        {params.then(({ id }) => (
          <DocumentReview id={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

/** Page text around the reported wording, so the reviewer sees the evidence in context. */
function EvidenceExcerpt({ text, wording }: { text: string; wording: string }) {
  const lines = text.split("\n");
  const target = normalizeForMatch(wording);
  const idx = lines.findIndex((l) => normalizeForMatch(l).includes(target) || target.includes(normalizeForMatch(l)) && l.length > 20);
  if (idx < 0) return <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-page p-2 text-xs text-ink-muted">{lines.slice(0, 8).join("\n")}</pre>;
  const from = Math.max(0, idx - 3);
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-page p-2 text-xs text-ink-2">
      {lines.slice(from, idx + 4).map((l, i) => (
        <span key={i} className={from + i === idx ? "bg-warn-bg font-semibold text-ink" : undefined}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

async function DocumentReview({ id }: { id: number }) {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const canReview = hasRole(access.user.role, "reviewer");
  const doc = getDocument(id);
  if (!doc) return <p className="text-sm text-ink-2">Document not found.</p>;
  const company = getCompany(doc.company_id);
  const fy = company ? { end: company.fy_end, labelConvention: company.fy_label_convention } : { end: "12-31", labelConvention: "end_year" as const };
  const jobs = jobsFor(id);
  const extractions = extractionsFor(id);
  const pages = new Map(pagesFor(id, [...new Set(extractions.map((e) => e.page_number))]).map((p) => [p.page_number, p]));
  const scanned = JSON.parse(doc.scanned_pages ?? "[]") as number[];
  const ocrRead = ocrPageNumbers(id);
  const unread = scanned.filter((n) => !ocrRead.includes(n));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-ink">{doc.title}</h1>
        <div className="mt-1 text-sm text-ink-2">
          {company?.name ?? doc.company_id} · {titleCase(doc.report_type)} · {doc.reporting_year ?? "year not given"} ·{" "}
          {LABELS.verification[doc.verification_class as keyof typeof LABELS.verification]}
        </div>
        <div className="text-xs text-ink-muted">
          {doc.filename} · sha256 {doc.sha256.slice(0, 16)}… · {doc.page_count ?? "?"} pages · uploaded by {doc.uploaded_by} on{" "}
          {doc.uploaded_at.slice(0, 16).replace("T", " ")}
          {doc.source_url && (
            <>
              {" · "}
              <a href={doc.source_url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                source
              </a>
            </>
          )}
        </div>
      </div>

      {ocrRead.length > 0 && (
        <div className="rounded-xl border border-hairline bg-warn-bg p-4 text-sm text-warn-ink">
          <span aria-hidden>⚠ </span>
          {ocrRead.length} page(s) had no text layer and were read by OCR: {ocrRead.slice(0, 30).join(", ")}
          {ocrRead.length > 30 ? "…" : ""}. OCR can misread digits: check every value from these pages (labelled “(OCR)”) against the page image before approving.
        </div>
      )}
      {unread.length > 0 && (
        <div className="rounded-xl border border-hairline bg-warn-bg p-4 text-sm text-warn-ink">
          <span aria-hidden>⚠ </span>
          {unread.length} page(s) have no text layer and could not be read (OCR found no text, or over the {MAX_OCR_PAGES}-page OCR limit):{" "}
          {unread.slice(0, 30).join(", ")}
          {unread.length > 30 ? "…" : ""}. Values on these pages were not extracted.
        </div>
      )}

      <Card title="Processing" action={canReview ? <RequeueButton documentId={id} /> : undefined}>
        <ul className="flex flex-col gap-1 text-sm">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap gap-2 text-ink-2">
              <Tag tone={j.status === "failed" ? "warn" : "neutral"}>{j.status}</Tag>
              <span>{j.kind.replace(/_/g, " ")}</span>
              <span className="text-xs text-ink-muted">
                attempt {j.attempts}/{j.max_attempts}
                {j.error ? ` · ${j.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {doc.error && <p className="mt-2 text-sm text-warn-ink">{doc.error}</p>}
      </Card>

      {GROUPS.map((g) => {
        const list = extractions.filter((e) => e.status === g.status);
        if (!list.length) return null;
        return (
          <Card key={g.status} title={`${g.title} (${list.length})`}>
            <ul className="flex flex-col gap-4">
              {list.map((e) => {
                const conflict = e.conflict ? (JSON.parse(e.conflict) as Conflict) : null;
                const page = pages.get(e.page_number);
                return (
                  <li key={e.id} className="border-b border-hairline pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="font-medium text-ink">{getMetric(e.metric_id).label}</span>{" "}
                        <span className="text-sm text-ink-muted">· {fiscalLabel(fy, e.year)}</span>
                      </div>
                      <div className="tabular text-ink">{formatReported(e.value, e.unit, e.text_value)}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Tag>{e.method === "ai" ? "Claude" : "Rule-based"}</Tag>
                      <Tag>confidence {Math.round(e.confidence * 100)}%</Tag>
                      <Tag tone={e.evidence_status === "verified" ? "neutral" : "warn"}>
                        Evidence {e.evidence_status === "verified" ? "verified" : "not found"}
                      </Tag>
                      {e.boundary !== "consolidated_group" && <Tag tone="warn">{LABELS.boundary[e.boundary as Boundary]}</Tag>}
                      {conflict?.type === "conflict" && <Tag tone="warn">Conflicts with curated value</Tag>}
                      {conflict?.type === "duplicate" && <Tag>Matches curated value</Tag>}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted">
                      {e.cell ?? e.page_label} · {LABELS.boundary[e.boundary as Boundary]} · {LABELS.consolidation[e.consolidation as Consolidation]}
                      {e.scope2_method ? ` · ${e.scope2_method}-based` : ""} · {e.evidence_detail}
                    </div>
                    {conflict && (
                      <div className="mt-1 text-xs text-ink-2">
                        Curated value: {conflict.existing.state === "disclosed" ? formatReported(conflict.existing.value ?? null, conflict.existing.unit ?? null, conflict.existing.text) : conflict.existing.state.replace(/_/g, " ")}
                        {conflict.existing.source ? ` (${conflict.existing.source}${conflict.existing.page ? `, ${conflict.existing.page}` : ""})` : ""}
                      </div>
                    )}
                    {page && <div className="mt-2"><EvidenceExcerpt text={page.text} wording={e.reported_wording} /></div>}
                    {e.reviewer && (
                      <div className="mt-1 text-xs text-ink-muted">
                        {titleCase(e.status)} by {e.reviewer} on {e.reviewed_at?.slice(0, 16).replace("T", " ")}
                        {e.review_reason ? `: ${e.review_reason}` : ""}
                      </div>
                    )}
                    {canReview && <ReviewActions id={e.id} status={e.status} conflict={conflict?.type ?? null} />}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      {extractions.length === 0 && (
        <p className="text-sm text-ink-muted">
          No proposals yet. If jobs are queued, start the worker with <code>npm run worker</code>.
        </p>
      )}
    </>
  );
}
