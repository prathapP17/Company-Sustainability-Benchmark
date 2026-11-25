import { connection } from "next/server";
import { pipelineDb } from "@/lib/pipeline/db";

/** Liveness for the container health check: the server answers and the pipeline database opens. */
export async function GET() {
  await connection(); // checked per request, never pre-built
  try {
    pipelineDb().prepare("SELECT 1").get();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
