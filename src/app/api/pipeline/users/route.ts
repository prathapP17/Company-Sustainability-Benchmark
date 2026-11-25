import { AccountError, inviteUser, LINK_TTL_MS, type Role } from "@/lib/auth/accounts";
import { passwordLinkUrl } from "@/lib/auth/links";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

/** Admins create accounts; the response carries the one-time invite link to pass on. */
export async function POST(req: Request) {
  const g = guardRequest(req, { mutating: true, role: "admin" });
  if (g instanceof Response) return g;
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; name?: unknown; role?: unknown };
  try {
    const { user, token } = inviteUser(pipelineDb(), { email: String(body.email ?? ""), name: String(body.name ?? ""), role: String(body.role ?? "") as Role }, g.reviewer);
    return Response.json({ ok: true, id: user.id, link: passwordLinkUrl(token, req.headers), expiresInHours: LINK_TTL_MS.invite / 3600_000 }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
