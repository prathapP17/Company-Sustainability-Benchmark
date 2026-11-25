/**
 * Exports and reports are for signed-in accounts (brief section 7: guests get
 * the public dashboards and company profiles; viewers and above also get
 * exports and reports). Every download is recorded in the audit log.
 */
import { connection } from "next/server";
import { guardRequest } from "../pipeline/access";
import { audit, pipelineDb } from "../pipeline/db";

export const EXPORT_HEADERS = { "Cache-Control": "private, no-store" };

/** Returns a Response to send back when access is refused, or null to continue. */
export async function exportAccess(req: Request, what: string): Promise<Response | null> {
  await connection(); // per request: reads the session, and includes values approved since the build
  const g = guardRequest(req, { mutating: false, role: "viewer" });
  if (g instanceof Response) return g;
  audit(pipelineDb(), g.reviewer, "export_download", "export", what);
  return null;
}
