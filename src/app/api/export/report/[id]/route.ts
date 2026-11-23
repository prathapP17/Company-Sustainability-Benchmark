import { companyPdf } from "@/lib/export/pdf";
import { listCompanyIds } from "@/lib/db/queries";

export function generateStaticParams() {
  return listCompanyIds().map((id) => ({ id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/api/export/report/[id]">) {
  const { id } = await ctx.params;
  const buf = await companyPdf(id);
  if (!buf) return new Response("Company not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${id}-sustainability-profile.pdf"`,
    },
  });
}
