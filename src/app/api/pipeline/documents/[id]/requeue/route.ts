import { guardRequest } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { requeueDocument } from "@/lib/pipeline/queue";

export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/documents/[id]/requeue">) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const db = pipelineDb();
  if (!db.prepare("SELECT 1 FROM documents WHERE id = ?").get(Number(id))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ jobId: requeueDocument(db, Number(id), g.reviewer) });
}
