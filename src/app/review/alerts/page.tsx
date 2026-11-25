import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { AcknowledgeButton } from "@/components/review/ReviewClient";
import { listCompanies } from "@/lib/db/queries";
import { listAlerts } from "@/lib/pipeline/queries";
import { hasRole } from "@/lib/auth/accounts";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "Alerts", robots: { index: false, follow: false } };

const KIND: Record<string, string> = {
  new_report: "New report",
  changed_report: "Report changed",
  source_changed: "Benchmark source changed",
  restatement: "Possible restatement",
  blocked: "Site blocked",
  fetch_failed: "Fetch failed",
};

export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / Alerts
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Alerts</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          New or changed reports, possible restatements of curated values, and sites that blocked automated access.
          Blocked sites are never worked around: fetch the file yourself and upload it, or use a regulator&apos;s copy.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <AlertList />
      </Suspense>
    </div>
  );
}

async function AlertList() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const open = listAlerts("open");
  const done = listAlerts("acknowledged", 50);
  const names = new Map(listCompanies().map((c) => [c.id, c.name]));
  const canReview = hasRole(access.user.role, "reviewer");

  const item = (a: (typeof open)[number], actions: boolean) => (
    <li key={a.id} className="flex flex-col gap-2 border-b border-hairline pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1">
          <Tag tone={a.kind === "restatement" || a.kind === "blocked" || a.kind === "source_changed" ? "warn" : "neutral"}>{KIND[a.kind] ?? a.kind}</Tag>
          {a.company_id && <Tag>{names.get(a.company_id) ?? a.company_id}</Tag>}
          <span className="text-xs text-ink-muted">{a.created_at.slice(0, 16).replace("T", " ")} UTC</span>
        </div>
        <div className="mt-1 text-sm break-words text-ink">{a.title}</div>
        <div className="mt-1 text-xs break-all text-ink-muted">
          {a.url && (
            <a href={a.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
              {a.url}
            </a>
          )}
          {a.document_id && (
            <>
              {a.url ? " · " : ""}
              <Link href={`/review/documents/${a.document_id}`} className="text-accent hover:underline">
                review document #{a.document_id}
              </Link>
            </>
          )}
          {!actions && a.acknowledged_by && ` · acknowledged by ${a.acknowledged_by}`}
        </div>
      </div>
      {actions && canReview && <AcknowledgeButton id={a.id} />}
    </li>
  );

  return (
    <>
      <Card title={`Open (${open.length})`}>
        {open.length === 0 ? <p className="text-sm text-ink-muted">No open alerts.</p> : <ul className="flex flex-col gap-3">{open.map((a) => item(a, true))}</ul>}
      </Card>
      {done.length > 0 && (
        <Card title="Recently acknowledged">
          <ul className="flex flex-col gap-3">{done.map((a) => item(a, false))}</ul>
        </Card>
      )}
    </>
  );
}
