import { exportAccess, EXPORT_HEADERS } from "@/lib/export/guard";
import { benchmarkPdf } from "@/lib/export/pdf";

export async function GET(req: Request) {
  const denied = await exportAccess(req, "report.pdf");
  if (denied) return denied;
  const buf = await benchmarkPdf();
  return new Response(new Uint8Array(buf), {
    headers: {
      ...EXPORT_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark-report.pdf"',
    },
  });
}
