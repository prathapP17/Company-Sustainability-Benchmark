import { checkSameOrigin, checkToken, cleanReviewerName, COOKIE, isLocal, makeCookieValue, pipelineEnabled } from "@/lib/pipeline/access";
import { audit, pipelineDb } from "@/lib/pipeline/db";

export async function POST(req: Request) {
  if (!pipelineEnabled()) return Response.json({ error: "pipeline disabled" }, { status: 404 });
  if (!isLocal(req.headers) || !checkSameOrigin(req.headers)) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { token?: string; name?: string };
  const name = cleanReviewerName(body.name ?? "");
  if (!name) return Response.json({ error: "enter your name" }, { status: 400 });
  if (!checkToken(body.token ?? "")) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    audit(pipelineDb(), name, "login_failed", "reviewer", null);
    return Response.json({ error: "wrong token" }, { status: 401 });
  }
  audit(pipelineDb(), name, "login", "reviewer", null);
  const res = Response.json({ ok: true, reviewer: name });
  res.headers.append(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(makeCookieValue(name))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 12}`,
  );
  return res;
}
