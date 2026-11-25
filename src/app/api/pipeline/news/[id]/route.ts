import { revalidatePath } from "next/cache";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { NewsError, reviewNews } from "@/lib/news/gdelt";

export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/news/[id]">) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
  if (body.action !== "approve" && body.action !== "reject") return Response.json({ error: "unknown action" }, { status: 400, headers: NO_STORE });
  try {
    reviewNews(pipelineDb(), Number(id), g.reviewer, body.action, typeof body.note === "string" ? body.note : undefined);
    revalidatePath("/companies/[id]", "page");
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof NewsError) return Response.json({ error: e.message }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
