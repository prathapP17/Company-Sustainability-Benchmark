import { connection } from "next/server";
import { Card, Tag } from "@/components/ui";
import { listNews } from "@/lib/news/gdelt";
import { pipelineDb } from "@/lib/pipeline/db";

/** Reviewer-approved news items only; secondary sources, never used in scores. Rendered per request. */
export async function NewsSignals({ companyId }: { companyId: string }) {
  await connection();
  const items = listNews(pipelineDb(), "approved", companyId, 10);
  if (!items.length) return null;
  return (
    <Card title="News and controversy signals" action={<Tag tone="warn">Secondary sources</Tag>}>
      <ul className="flex flex-col gap-3">
        {items.map((n) => (
          <li key={n.id} className="text-sm">
            <a href={n.url} className="break-words text-accent hover:underline" target="_blank" rel="noreferrer noopener">
              {n.title}
            </a>
            <div className="mt-1 text-xs text-ink-muted">
              {n.domain}
              {n.seen_at ? ` · ${n.seen_at.slice(0, 10)}` : ""}
            </div>
            {n.note && <p className="mt-1 text-xs text-ink-2">{n.note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        News reports found through the GDELT news index and selected by a reviewer for relevance. They are not verified
        facts, are not company disclosures, and do not affect any value or score on this site.
      </p>
    </Card>
  );
}
