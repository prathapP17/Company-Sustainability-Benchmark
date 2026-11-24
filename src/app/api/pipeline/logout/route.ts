import { COOKIE, checkSameOrigin } from "@/lib/pipeline/access";

export async function POST(req: Request) {
  if (!checkSameOrigin(req.headers)) return Response.json({ error: "forbidden" }, { status: 403 });
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res;
}
