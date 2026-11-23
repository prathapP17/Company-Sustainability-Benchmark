import { benchmarkPdf } from "@/lib/export/pdf";

export async function GET() {
  const buf = await benchmarkPdf();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark-report.pdf"',
    },
  });
}
