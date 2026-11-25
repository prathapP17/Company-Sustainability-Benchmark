import { AccountError, changePassword } from "@/lib/auth/accounts";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

/** Any signed-in account may change its own password; other devices are signed out. */
export async function POST(req: Request) {
  const g = guardRequest(req, { mutating: true, role: "viewer" });
  if (g instanceof Response) return g;
  const body = (await req.json().catch(() => ({}))) as { current?: unknown; next?: unknown };
  try {
    changePassword(pipelineDb(), g.user.id, String(body.current ?? ""), String(body.next ?? ""), g.user.tokenHash);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
