import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Tag } from "@/components/ui";
import { GenerateSummaryButton, SummaryCandidateActions } from "@/components/review/Phase6Client";
import { listCandidates } from "@/lib/summaries/candidates";
import type { Fact } from "@/lib/summaries/facts";
import type { Problem, Sentence } from "@/lib/summaries/check";
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
          AI-written, only if the automatic evidence gate passes for every sentence: numbers, years and units must match a
          cited fact, named metrics and target phrases must appear in it, trends need a cited year-on-year change in the
          same direction, and causes, comparisons, target-status judgements and interpretations are refused. When the gate
          fails only on wording, the summary waits below for a reviewer (manual-review fallback); a summary with an
          unsupported claim can never be approved. A summary is hidden when the company&apos;s data changes. Each run costs
          API credits.
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
  const access = await currentAccess("reviewer");
  if (!access.ok) return <Denied access={access} />;
  const canGenerate = hasRole(access.user.role, "reviewer") && aiEnabled();
  const attempts = pipelineDb()
    .prepare("SELECT at, actor, action, entity_id, details FROM audit_log WHERE action IN ('summary_published','summary_rejected_by_check') ORDER BY id DESC LIMIT 200")
    .all() as Attempt[];
  const last = new Map<string, Attempt>();
  for (const a of attempts) if (!last.has(a.entity_id)) last.set(a.entity_id, a);
  const pending = listCandidates(pipelineDb(), "pending");
  return (
    <>
      {!aiEnabled() && <p className="text-sm text-warn-ink">ANTHROPIC_API_KEY is not set, so summaries cannot be generated.</p>}
      <Card title={`Waiting for manual review (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing waiting. Summaries that fail the gate only on wording appear here.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {pending.map((c) => {
              const facts = new Map((JSON.parse(c.facts) as Fact[]).map((f) => [f.id, f]));
              const problems = JSON.parse(c.problems) as Problem[];
              return (
                <li key={c.id} className="flex flex-col gap-3 border-b border-hairline pb-4 last:border-0">
                  <p className="text-sm font-medium text-ink">
                    {c.company_id} · written {c.created_at.slice(0, 16).replace("T", " ")} by {c.created_by}
                  </p>
                  <ol className="flex flex-col gap-2 text-sm">
                    {(JSON.parse(c.sentences) as Sentence[]).map((s, i) => (
                      <li key={i} className="rounded border border-hairline p-2">
                        <p className="text-ink">{s.text}</p>
                        <ul className="mt-1 text-xs text-ink-2">
                          {s.citations.map((id) => (
                            <li key={id}>
                              <span className="tabular text-ink-muted">{id}</span> {facts.get(id)?.text ?? "(unknown fact)"}
                            </li>
                          ))}
                        </ul>
                        {problems
                          .filter((p) => p.sentence === i + 1)
                          .map((p) => (
                            <p key={p.message} className="mt-1 text-xs text-warn-ink">
                              Flagged ({p.kind}): {p.message}
                            </p>
                          ))}
                      </li>
                    ))}
                  </ol>
                  {problems
                    .filter((p) => p.sentence === null)
                    .map((p) => (
                      <p key={p.message} className="text-xs text-warn-ink">
                        Flagged: {p.message}
                      </p>
                    ))}
                  <SummaryCandidateActions id={c.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
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
