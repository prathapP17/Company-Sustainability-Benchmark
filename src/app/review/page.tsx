import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { LogoutButton, UploadForm } from "@/components/review/ReviewClient";
import { listCompanies } from "@/lib/db/queries";
import { listDocuments, queueStats } from "@/lib/pipeline/queries";
import { aiEnabled } from "@/lib/pipeline/extract/ai";
import { currentAccess } from "./gate";
import { Denied } from "./Denied";

export const metadata: Metadata = { title: "Review queue", robots: { index: false, follow: false } };

export default function ReviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Upload and review</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Uploaded reports are parsed by the background worker (<code>npm run worker</code>). Extracted values are proposals:
          each is checked against the stored page text and needs a reviewer&apos;s approval before it enters the benchmark.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Checking access…</p>}>
        <ReviewHome />
      </Suspense>
    </div>
  );
}

async function ReviewHome() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const docs = listDocuments();
  const stats = new Map(queueStats().map((s) => [s.status, s.n]));
  const companies = listCompanies().map((c) => ({ id: c.id, name: c.name }));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <span>
          Signed in as <b className="text-ink">{access.reviewer}</b> · Jobs: {stats.get("queued") ?? 0} queued,{" "}
          {stats.get("running") ?? 0} running, {stats.get("failed") ?? 0} failed · Claude extraction{" "}
          {aiEnabled() ? "on" : "off (no ANTHROPIC_API_KEY)"}
        </span>
        <span className="flex gap-4">
          <Link href="/review/audit" className="text-accent hover:underline">
            Audit log
          </Link>
          <LogoutButton />
        </span>
      </div>

      <Card title="Upload a document">
        <UploadForm companies={companies} />
      </Card>

      <Card title="Documents">
        {docs.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing uploaded yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Document</th>
                  <th className="py-2 pr-3 font-medium">Company</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">To review</th>
                  <th className="py-2 font-medium">Done</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const scanned = (JSON.parse(d.scanned_pages ?? "[]") as number[]).length;
                  return (
                    <tr key={d.id} className="border-b border-hairline align-top last:border-0">
                      <td className="tabular py-2 pr-3 text-ink-muted">{d.id}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/review/documents/${d.id}`} className="text-accent hover:underline">
                          {d.title}
                        </Link>
                        <div className="text-xs text-ink-muted">
                          {d.filename} · {(d.size_bytes / 1024 / 1024).toFixed(1)} MB · uploaded by {d.uploaded_by} {d.uploaded_at.slice(0, 10)}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-ink-2">{companyName.get(d.company_id) ?? d.company_id}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          <Tag tone={d.status === "failed" ? "warn" : "neutral"}>{d.status.replace(/_/g, " ")}</Tag>
                          {d.queued_jobs + d.running_jobs > 0 && <Tag>{d.running_jobs ? "processing" : "queued"}</Tag>}
                          {d.failed_jobs > 0 && <Tag tone="warn">{d.failed_jobs} failed job(s)</Tag>}
                          {scanned > 0 && <Tag tone="warn">{scanned} page(s) need OCR</Tag>}
                        </div>
                      </td>
                      <td className="tabular py-2 pr-3 text-ink-2">
                        {d.pending} pending · {d.blocked} blocked{d.conflicts ? ` · ${d.conflicts} conflicts` : ""}
                      </td>
                      <td className="tabular py-2 text-ink-2">
                        {d.approved} approved · {d.rejected} rejected
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
