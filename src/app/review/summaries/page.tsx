import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { GenerateSummaryButton } from "@/components/review/Phase6Client";
import { hasRole } from "@/lib/auth/accounts";
import { listCompanies } from "@/lib/db/queries";
import { aiEnabled } from "@/lib/pipeline/extract/ai";
import { pipelineDb } from "@/lib/pipeline/db";
import { summaryState } from "@/lib/summaries/store";
import { currentAccess } from "../gate";
import { Denied } from "../Denied";

export const metadata: Metadata = { title: "AI summaries", robots: { index: false, follow: false } };

export default function SummariesPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/review" className="hover:underline">
          Upload and review
        </Link>{" "}
        / AI summaries
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">AI summaries</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Claude writes each summary from the company&apos;s curated facts only. It is published straight away, labelled as
          AI-written, but only if the automatic check passes: every number must appear in a fact the sentence cites, and
          comparisons or judgements are refused. A summary is hidden when the company&apos;s data changes. Each run costs API
          credits.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <List />
      </Suspense>
    </div>
  );
}

type Attempt = { at: string; actor: string; action: string; entity_id: string; details: string | null };

async function List() {
  const access = await currentAccess();
  if (!access.ok) return <Denied access={access} />;
  const canGenerate = hasRole(access.user.role, "reviewer") && aiEnabled();
  const attempts = pipelineDb()
    .prepare("SELECT at, actor, action, entity_id, details FROM audit_log WHERE action IN ('summary_published','summary_rejected_by_check') ORDER BY id DESC LIMIT 200")
    .all() as Attempt[];
  const last = new Map<string, Attempt>();
  for (const a of attempts) if (!last.has(a.entity_id)) last.set(a.entity_id, a);
  return (
    <>
      {!aiEnabled() && <p className="text-sm text-warn-ink">ANTHROPIC_API_KEY is not set, so summaries cannot be generated.</p>}
      <Card title="Companies">
        <ul className="flex flex-col gap-3">
          {listCompanies().map((c) => {
            const st = summaryState(c.id);
            const a = last.get(c.id);
            const problems = a?.action === "summary_rejected_by_check" ? ((JSON.parse(a.details ?? "{}") as { problems?: string[] }).problems ?? []) : [];
            return (
              <li key={c.id} className="flex flex-col gap-2 border-b border-hairline pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/companies/${c.id}`} className="text-sm text-accent hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-ink-muted">
                    <Tag tone={st.kind === "current" ? "neutral" : "warn"}>
                      {st.kind === "current" ? "Published" : st.kind === "outdated" ? "Hidden: data changed" : "No summary"}
                    </Tag>
                    {st.kind !== "none" && <span>written {st.summary.generatedAt.slice(0, 10)} by {st.summary.generatedBy}</span>}
                  </div>
                  {problems.length > 0 && (
                    <div className="mt-1 text-xs text-warn-ink">
                      Last attempt {a!.at.slice(0, 10)} failed the check: {problems.slice(0, 3).join("; ")}
                      {problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}
                    </div>
                  )}
                </div>
                {canGenerate && <GenerateSummaryButton id={c.id} label={st.kind === "none" ? "Generate" : "Regenerate"} />}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
