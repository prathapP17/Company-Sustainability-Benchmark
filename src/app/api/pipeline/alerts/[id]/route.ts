import { guardRequest } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { acknowledgeAlert } from "@/lib/discovery/alerts";

export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/alerts/[id]">) {
  const g = guardRequest(req, true);
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const ok = acknowledgeAlert(pipelineDb(), Number(id), g.reviewer);
  return ok ? Response.json({ status: "acknowledged" }) : Response.json({ error: "not found or already acknowledged" }, { status: 409 });
}
