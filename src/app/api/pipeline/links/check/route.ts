import { checkLink } from "@/lib/auth/accounts";
import { allowedHost, checkSameOrigin, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

/** Tells the set-password page whose link this is. The token travels in the body, never the URL. */
export async function POST(req: Request) {
  if (!allowedHost(req.headers) || !checkSameOrigin(req.headers)) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const info = typeof body.token === "string" ? checkLink(pipelineDb(), body.token) : null;
  if (!info) return Response.json({ error: "this link is invalid, used or expired; ask an admin for a new one" }, { status: 404, headers: NO_STORE });
  return Response.json({ purpose: info.purpose, name: info.user.name, email: info.user.email }, { headers: NO_STORE });
}
