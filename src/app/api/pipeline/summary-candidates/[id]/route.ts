import { revalidatePath } from "next/cache";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { reviewCandidate, SummaryReviewError } from "@/lib/summaries/candidates";

/** Manual-review fallback: a reviewer approves (with a note) or rejects a summary the automatic gate flagged on wording only. */
export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/summary-candidates/[id]">) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  const id = Number((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as { action?: string; note?: string };
  if (!Number.isInteger(id) || (body.action !== "approve" && body.action !== "reject")) {
    return Response.json({ error: "invalid request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const db = pipelineDb();
    reviewCandidate(db, id, g.reviewer, body.action, String(body.note ?? ""));
    const row = db.prepare("SELECT company_id FROM summary_candidates WHERE id = ?").get(id) as { company_id: string };
    revalidatePath(`/companies/${row.company_id}`);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof SummaryReviewError) return Response.json({ error: e.message }, { status: 409, headers: NO_STORE });
    throw e;
  }
}
