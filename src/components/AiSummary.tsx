import { connection } from "next/server";
import { Card, Tag } from "@/components/ui";
import { summaryState } from "@/lib/summaries/store";

/**
 * AI-written summary (user decision 2026-11-25: published without human review,
 * only after the automatic citation check). Rendered per request so it is never
 * stale: a summary whose facts have changed is hidden.
 */
export async function AiSummary({ companyId }: { companyId: string }) {
  await connection();
  const st = summaryState(companyId);
  if (st.kind === "none") return null;
  if (st.kind === "outdated") {
    return (
      <Card title="AI-generated summary">
        <p className="text-sm text-ink-muted">Hidden: the data on this page changed after the summary was written. It will return once regenerated.</p>
      </Card>
    );
  }
  const s = st.summary;
  const facts = new Map(s.facts.map((f) => [f.id, f]));
  return (
    <Card title="AI-generated summary" action={<Tag tone="warn">Written by AI</Tag>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-ink">
          {s.sentences.map((sen, i) => (
            <span key={i}>
              {sen.text}
              {sen.citations.map((c) => {
                const f = facts.get(c);
                return (
                  <sup key={c} className="ml-0.5">
                    <a href={f?.url ?? "#facts-used"} title={f?.text} className="text-accent hover:underline" target={f?.url ? "_blank" : undefined} rel="noreferrer">
                      [{c}]
                    </a>
                  </sup>
                );
              })}{" "}
            </span>
          ))}
        </p>
        <details id="facts-used" className="text-xs text-ink-2">
          <summary className="cursor-pointer text-ink-muted">Facts used ({s.facts.length})</summary>
          <ol className="mt-2 flex flex-col gap-1">
            {s.facts.map((f) => (
              <li key={f.id}>
                <span className="tabular text-ink-muted">{f.id}</span> {f.text}
                {f.sourceId && (
                  <>
                    {" · "}
                    {f.url ? (
                      <a href={f.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                        {f.sourceId}
                        {f.page ? `, ${f.page}` : ""}
                      </a>
                    ) : (
                      `${f.sourceId}${f.page ? `, ${f.page}` : ""}`
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        </details>
        <p className="text-xs text-ink-muted">
          Written by Claude ({s.model}) on {s.generatedAt.slice(0, 10)} from the curated data on this page only. Checked automatically: every
          number appears in a cited fact and no comparisons or judgements are made. Not reviewed by a person; the values
          and sources on this page take precedence.
        </p>
      </div>
    </Card>
  );
}
