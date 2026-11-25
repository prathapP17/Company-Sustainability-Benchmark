import { AccountError, setPasswordWithLink } from "@/lib/auth/accounts";
import { allowedHost, checkSameOrigin, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

/** Sets a password with a one-time invite or reset link; the user then signs in normally. */
export async function POST(req: Request) {
  if (!allowedHost(req.headers) || !checkSameOrigin(req.headers)) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; password?: unknown };
  try {
    const user = setPasswordWithLink(pipelineDb(), String(body.token ?? ""), String(body.password ?? ""));
    return Response.json({ ok: true, email: user.email }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
