import { guardRequest, NO_STORE } from "@/lib/pipeline/access";
import { reviewOverview } from "@/lib/pipeline/queries";

/**
 * Queue counts for the dashboard's pending-review strip. Reviewers and admins
 * only. Everyone else gets 204 No Content: nothing is revealed, and guests'
 * browsers do not log an error on every dashboard visit.
 */
export async function GET(req: Request) {
  const g = guardRequest(req, { mutating: false, role: "reviewer" });
  if (g instanceof Response) return new Response(null, { status: 204, headers: NO_STORE });
  return Response.json(reviewOverview(), { headers: NO_STORE });
}
