import { benchmarkWorkbook } from "@/lib/export/xlsx";

export async function GET() {
  const buf = await benchmarkWorkbook();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark.xlsx"',
    },
  });
}
