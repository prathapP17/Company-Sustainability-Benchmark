import { logout } from "@/lib/auth/accounts";
import { checkSameOrigin, cookieFrom, NO_STORE, sessionCookie } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

export async function POST(req: Request) {
  if (!checkSameOrigin(req.headers)) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  logout(pipelineDb(), cookieFrom(req.headers));
  const res = Response.json({ ok: true }, { headers: NO_STORE });
  res.headers.append("Set-Cookie", sessionCookie(null, 0));
  return res;
}
