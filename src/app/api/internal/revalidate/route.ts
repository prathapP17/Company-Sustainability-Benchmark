import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isLocal } from "@/lib/pipeline/access";

/**
 * Called once by the container entrypoint after start-up: public pages were
 * pre-built from the data inside the image, so they are refreshed from the
 * live data folder. Loopback only, and needs the per-start INTERNAL_TOKEN.
 */
export async function POST(req: Request) {
  const expected = process.env.INTERNAL_TOKEN ?? "";
  const got = req.headers.get("x-internal-token") ?? "";
  const ok = expected.length >= 32 && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok || !isLocal(req.headers)) return Response.json({ error: "not found" }, { status: 404 });
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
