import { login, SESSION_MAX_MS } from "@/lib/auth/accounts";
import { allowedHost, checkSameOrigin, clientIp, NO_STORE, sessionCookie } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

export async function POST(req: Request) {
  if (!allowedHost(req.headers) || !checkSameOrigin(req.headers)) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  if (!email || !password) return Response.json({ error: "enter your email and password" }, { status: 400, headers: NO_STORE });
  const r = login(pipelineDb(), email, password, { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") ?? "" });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  const res = Response.json({ ok: true, user: { name: r.user.name, role: r.user.role } }, { headers: NO_STORE });
  res.headers.append("Set-Cookie", sessionCookie(r.token, Math.floor(SESSION_MAX_MS / 1000)));
  return res;
}
