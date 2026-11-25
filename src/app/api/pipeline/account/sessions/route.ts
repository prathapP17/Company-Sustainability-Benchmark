import { revokeSessions } from "@/lib/auth/accounts";
import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";

/** Signs the account out on every other device. */
export async function POST(req: Request) {
  const g = guardRequest(req, { mutating: true, role: "viewer" });
  if (g instanceof Response) return g;
  const n = revokeSessions(pipelineDb(), g.user.id, g.reviewer, g.user.tokenHash);
  return Response.json({ ok: true, signedOut: n }, { headers: NO_STORE });
}
