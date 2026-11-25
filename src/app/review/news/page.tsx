import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { NewsActions } from "@/components/review/Phase6Client";
import { hasRole } from "@/lib/auth/accounts";
import { listCompanies } from "@/lib/db/queries";
import { listNews, type NewsRow } from "@/lib/news/gdelt";
import { pipelineDb } from "@/lib/pipeline/db";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "News signals", robots: { index: false, follow: false } };

export default function NewsReviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / News signals
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">News and controversy signals</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Headlines found by the weekly refresh in the GDELT news index (<code>npm run news</code> to search now). They are
          secondary, unverified sources: nothing is shown publicly until a reviewer approves it with a short note, and
          approved items never affect scores or values.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <Queues />
      </Suspense>
    </div>
  );
}

async function Queues() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const canReview = hasRole(access.user.role, "reviewer");
  const db = pipelineDb();
  const names = new Map(listCompanies().map((c) => [c.id, c.name]));
  const item = (n: NewsRow) => (
    <li key={n.id} className="flex flex-col gap-2 border-b border-hairline pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <a href={n.url} className="text-sm break-words text-accent hover:underline" target="_blank" rel="noreferrer noopener">
          {n.title}
        </a>
        <div className="mt-1 flex flex-wrap gap-1 text-xs text-ink-muted">
          <Tag>{names.get(n.company_id) ?? n.company_id}</Tag>
          {(JSON.parse(n.topics ?? "[]") as string[]).map((t) => (
            <Tag key={t} tone="warn">
              {t}
            </Tag>
          ))}
          <span>
            {n.domain ?? ""}
            {n.seen_at ? ` · ${n.seen_at.slice(0, 10)}` : ""}
            {n.source_country ? ` · ${n.source_country}` : ""}
          </span>
        </div>
        {n.note && <p className="mt-1 text-xs text-ink-2">Note: {n.note} ({n.reviewer})</p>}
      </div>
      {canReview && n.status !== "rejected" && <NewsActions id={n.id} approved={n.status === "approved"} />}
    </li>
  );
  const pending = listNews(db, "pending");
  const approved = listNews(db, "approved");
  return (
    <>
      <Card title={`To review (${pending.length})`}>
        {pending.length ? <ul className="flex flex-col gap-3">{pending.map(item)}</ul> : <p className="text-sm text-ink-muted">Nothing waiting.</p>}
      </Card>
      <Card title={`Approved and shown publicly (${approved.length})`}>
        {approved.length ? <ul className="flex flex-col gap-3">{approved.map(item)}</ul> : <p className="text-sm text-ink-muted">None yet.</p>}
      </Card>
    </>
  );
}
