import { cookies, headers } from "next/headers";
import type { Role } from "@/lib/auth/accounts";
import { checkAccess, COOKIE, type AccessResult } from "@/lib/pipeline/access";

/** Access check for review pages. Called by every page (never only a layout). */
export async function currentAccess(min: Role = "viewer"): Promise<AccessResult> {
  const h = await headers();
  const c = await cookies();
  return checkAccess(h, c.get(COOKIE)?.value, min);
}
