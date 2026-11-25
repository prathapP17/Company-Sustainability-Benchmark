import { revalidatePath } from "next/cache";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { aiEnabled } from "@/lib/pipeline/extract/ai";
import { summarizeCompany } from "@/lib/summaries/run";

/** Reviewers generate a company's AI summary; it is published only if the automatic check passes. */
export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/summaries/[id]">) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  if (!aiEnabled()) return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 409, headers: NO_STORE });
  const { id } = await ctx.params;
  try {
    const r = await summarizeCompany(pipelineDb(), id, g.reviewer);
    revalidatePath(`/companies/${id}`);
    return Response.json(r, { headers: NO_STORE });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502, headers: NO_STORE });
  }
}
