import { revalidatePath } from "next/cache";
import { guardRequest } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { ReviewError, reviewExtraction, type ReviewAction } from "@/lib/pipeline/review";
import { defaultDataDir } from "@/lib/data/load";

const ACTIONS = new Set(["approve", "approve_restatement", "override_approve", "reject"]);

export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/extractions/[id]">) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  if (!body.action || !ACTIONS.has(body.action)) return Response.json({ error: "unknown action" }, { status: 400 });
  try {
    const dataDir = defaultDataDir();
    const r = reviewExtraction(pipelineDb(dataDir), dataDir, Number(id), g.reviewer, {
      action: body.action,
      reason: body.reason?.toString().slice(0, 500),
    } as ReviewAction);
    // Approvals change the curated data: refresh the pre-built public pages on their next visit.
    if (body.action !== "reject") revalidatePath("/", "layout");
    return Response.json(r);
  } catch (e) {
    if (e instanceof ReviewError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
