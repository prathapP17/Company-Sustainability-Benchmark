import { companyPdf } from "@/lib/export/pdf";
import { exportAccess, EXPORT_HEADERS } from "@/lib/export/guard";

export async function GET(req: Request, ctx: RouteContext<"/api/export/report/[id]">) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) return new Response("Company not found", { status: 404 });
  const denied = await exportAccess(req, `report/${id}`);
  if (denied) return denied;
  const buf = await companyPdf(id);
  if (!buf) return new Response("Company not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      ...EXPORT_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${id}-sustainability-profile.pdf"`,
    },
  });
}
