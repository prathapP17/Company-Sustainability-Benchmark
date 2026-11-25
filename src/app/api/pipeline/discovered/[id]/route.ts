import { guardRequest } from "@/lib/pipeline/access";
import { audit, pipelineDb } from "@/lib/pipeline/db";
import { fetchDiscovered, makeHttp, type DiscoveredRow } from "@/lib/discovery/discover";
import { loadDiscoveryConfig } from "@/lib/discovery/config";
import { defaultDataDir } from "@/lib/data/load";

/** Reviewer actions on a discovered report: fetch it into the pipeline, or skip it. */
export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/discovered/[id]">) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const dataDir = defaultDataDir();
  const db = pipelineDb(dataDir);
  const row = db.prepare("SELECT * FROM discovered_documents WHERE id = ?").get(Number(id)) as DiscoveredRow | undefined;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  if (body.action === "skip") {
    db.prepare("UPDATE discovered_documents SET status = 'skipped' WHERE id = ?").run(row.id);
    audit(db, g.reviewer, "skip_discovered", "discovered_document", row.id, { url: row.url });
    return Response.json({ status: "skipped" });
  }
  if (body.action === "fetch") {
    const cfg = loadDiscoveryConfig(dataDir);
    const ua = row.origin === "sec" ? process.env.SEC_USER_AGENT?.trim() : undefined;
    if (row.origin === "sec" && !ua) return Response.json({ error: "set SEC_USER_AGENT in .env.local to fetch SEC filings" }, { status: 400 });
    const r = await fetchDiscovered(db, dataDir, makeHttp(db, cfg, {}, ua), row, g.reviewer);
    return r.ok ? Response.json({ status: "fetched" }) : Response.json({ error: r.error ?? "fetch failed" }, { status: 502 });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}
