import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { recentAudit } from "@/lib/pipeline/queries";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };

export default function AuditPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / Audit log
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Audit log</h1>
        <p className="mt-1 text-sm text-ink-2">Append-only record of uploads, extraction runs and review decisions (latest 200).</p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <AuditTable />
      </Suspense>
    </div>
  );
}

async function AuditTable() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const rows = recentAudit();
  return (
    <Card>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink-muted">
              <th className="py-2 pr-3 font-medium">When (UTC)</th>
              <th className="py-2 pr-3 font-medium">Who</th>
              <th className="py-2 pr-3 font-medium">Action</th>
              <th className="py-2 pr-3 font-medium">Entity</th>
              <th className="py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-hairline align-top last:border-0">
                <td className="tabular py-2 pr-3 text-ink-muted">{r.at.slice(0, 19).replace("T", " ")}</td>
                <td className="py-2 pr-3 text-ink">{r.actor}</td>
                <td className="py-2 pr-3 text-ink-2">{r.action.replace(/_/g, " ")}</td>
                <td className="py-2 pr-3 text-ink-2">
                  {r.entity}
                  {r.entity_id ? ` #${r.entity_id}` : ""}
                </td>
                <td className="py-2 font-mono text-xs break-all text-ink-muted">{r.details ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
