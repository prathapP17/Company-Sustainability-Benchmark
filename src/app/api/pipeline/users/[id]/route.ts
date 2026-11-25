import { AccountError, LINK_TTL_MS, newPasswordLink, revokeSessions, setDisabled, setRole, type Role } from "@/lib/auth/accounts";
import { passwordLinkUrl } from "@/lib/auth/links";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

/** Admin actions on one account: role, disable/enable, new password link, sign out everywhere. */
export async function POST(req: Request, ctx: RouteContext<"/api/pipeline/users/[id]">) {
  const g = guardRequest(req, { mutating: true, role: "admin" });
  if (g instanceof Response) return g;
  const id = Number((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; role?: unknown };
  const db = pipelineDb();
  try {
    switch (body.action) {
      case "role":
        setRole(db, id, String(body.role ?? "") as Role, g.reviewer);
        return Response.json({ ok: true }, { headers: NO_STORE });
      case "disable":
        if (id === g.user.id) throw new AccountError("you cannot disable your own account");
        setDisabled(db, id, true, g.reviewer);
        return Response.json({ ok: true }, { headers: NO_STORE });
      case "enable":
        setDisabled(db, id, false, g.reviewer);
        return Response.json({ ok: true }, { headers: NO_STORE });
      case "link": {
        const { purpose, token } = newPasswordLink(db, id, g.reviewer);
        return Response.json({ ok: true, purpose, link: passwordLinkUrl(token, req.headers), expiresInHours: LINK_TTL_MS[purpose] / 3600_000 }, { headers: NO_STORE });
      }
      case "revoke":
        return Response.json({ ok: true, signedOut: revokeSessions(db, id, g.reviewer, id === g.user.id ? g.user.tokenHash : undefined) }, { headers: NO_STORE });
      default:
        return Response.json({ error: "unknown action" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
