import { exportAccess, EXPORT_HEADERS } from "@/lib/export/guard";
import { benchmarkWorkbook } from "@/lib/export/xlsx";

export async function GET(req: Request) {
  const denied = await exportAccess(req, "benchmark.xlsx");
  if (denied) return denied;
  const buf = await benchmarkWorkbook();
  return new Response(new Uint8Array(buf), {
    headers: {
      ...EXPORT_HEADERS,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark.xlsx"',
    },
  });
}
