import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { DiscoveredActions } from "@/components/review/ReviewClient";
import { listCompanies } from "@/lib/db/queries";
import { listDiscovered, recentRuns } from "@/lib/pipeline/queries";
import { titleCase } from "@/lib/format";
import { hasRole } from "@/lib/auth/accounts";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "Discovered reports", robots: { index: false, follow: false } };

const STATUS_TEXT: Record<string, string> = {
  new: "New",
  awaiting_fetch: "Awaiting fetch",
  fetched: "Fetched",
  known: "Already used",
  skipped: "Skipped",
  blocked: "Blocked",
  failed: "Failed",
};

export default function DiscoveredPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / Discovered reports
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Discovered reports</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Report links found by the weekly refresh on each company&apos;s official pages and SEC EDGAR. Recent English
          reports on a company&apos;s own domain are fetched automatically (at most 3 per company per run); everything else
          waits here until you fetch it. Fetched reports go through extraction and review like uploads.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <DiscoveredList />
      </Suspense>
    </div>
  );
}

async function DiscoveredList() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const rows = listDiscovered();
  const runs = recentRuns();
  const names = new Map(listCompanies().map((c) => [c.id, c.name]));
  const canReview = hasRole(access.user.role, "reviewer");

  return (
    <>
      <Card title="Recent discovery runs">
        {runs.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No runs yet. Run <code>npm run refresh</code>, or install the weekly job with <code>npm run launchd:install</code>.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-ink-2">
            {runs.map((r) => (
              <li key={r.id}>
                #{r.id} · {r.started_at.slice(0, 16).replace("T", " ")} UTC · {r.trigger} · {r.pages_read} page{r.pages_read === 1 ? "" : "s"} read · {r.found} report link{r.found === 1 ? "" : "s"} ·{" "}
                {r.fetched} auto-fetched · {r.alerts} alerts{r.finished_at ? "" : " · still running or interrupted"}
                {r.error && <div className="text-xs whitespace-pre-line text-ink-muted">{r.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Reports (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing discovered yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 border-b border-hairline pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words text-ink">{r.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Tag tone={r.status === "blocked" || r.status === "failed" ? "warn" : "neutral"}>{STATUS_TEXT[r.status] ?? r.status}</Tag>
                    <Tag>{names.get(r.company_id) ?? r.company_id}</Tag>
                    <Tag>{titleCase(r.report_type)}</Tag>
                    {r.year && <Tag>{r.year}</Tag>}
                    {r.language !== "en" && <Tag>{r.language}</Tag>}
                    {r.official ? <Tag>Official domain</Tag> : <Tag tone="warn">{r.origin === "sec" ? "SEC EDGAR" : "Other domain"}</Tag>}
                  </div>
                  <div className="mt-1 text-xs break-all text-ink-muted">
                    <a href={r.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                      {r.url}
                    </a>
                    {r.content_length ? ` · ${(r.content_length / 1048576).toFixed(1)} MB` : ""}
                    {r.last_changed ? ` · changed ${r.last_changed.slice(0, 10)}` : ""}
                    {r.error ? ` · ${r.error}` : ""}
                    {r.document_id && (
                      <>
                        {" · "}
                        <Link href={`/review/documents/${r.document_id}`} className="text-accent hover:underline">
                          document #{r.document_id}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                {canReview && ["new", "awaiting_fetch", "failed", "blocked"].includes(r.status) && (
                  <DiscoveredActions id={r.id} canFetch={r.status !== "blocked"} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
