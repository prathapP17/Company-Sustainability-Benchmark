import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { listCompanies } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Downloads" };

const LINK = "text-accent hover:underline";

export default function DownloadsPage() {
  const companies = listCompanies().filter((c) => c.research_status !== "profile_only");
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Downloads</h1>
        <p className="mt-1 text-sm text-ink-2">
          All exports include source, page, boundary, method, assurance and verification class for every value.
          Reviewer-only notes are removed.
        </p>
        <p className="mt-2 rounded-lg border border-hairline bg-surface p-3 text-sm text-ink-2">
          Downloads need an account (viewer, reviewer or admin).{" "}
          <Link href="/review" className="text-accent hover:underline">
            Sign in
          </Link>{" "}
          first; without an account the links answer &ldquo;Sign in&rdquo;. Every value is also shown, with its source, on
          the public company pages. Each download is recorded in the audit log.
        </p>
      </div>
      <Card title="Full benchmark">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <a className={LINK} href="/api/export/values.csv" download>
              All values (CSV)
            </a>{" "}
            <span className="text-ink-muted">· one row per value, every state</span>
          </li>
          <li>
            <a className={LINK} href="/api/export/benchmark.xlsx" download>
              Benchmark workbook (XLSX)
            </a>{" "}
            <span className="text-ink-muted">· values, companies, sources, targets, scores, checklist, read-me</span>
          </li>
          <li>
            <a className={LINK} href="/api/export/report.pdf" download>
              Management report (PDF)
            </a>{" "}
            <span className="text-ink-muted">· scores, coverage and headline values for all companies</span>
          </li>
        </ul>
      </Card>
      <Card title="Company reports (PDF)">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {companies.map((c) => (
            <li key={c.id}>
              <a className={LINK} href={`/api/export/report/${c.id}`} download>
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
