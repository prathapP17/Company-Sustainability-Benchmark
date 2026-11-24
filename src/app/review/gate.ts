import { cookies, headers } from "next/headers";
import { checkAccess, COOKIE, type AccessResult } from "@/lib/pipeline/access";

/** Access check for review pages. Called by every page (never only a layout). */
export async function currentAccess(): Promise<AccessResult> {
  const h = await headers();
  const c = await cookies();
  return checkAccess(h, c.get(COOKIE)?.value);
}
