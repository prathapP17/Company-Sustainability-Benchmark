import { exportAccess, EXPORT_HEADERS } from "@/lib/export/guard";
import { toCsv, VALUE_COLUMNS, valueRows } from "@/lib/export/rows";

export async function GET(req: Request) {
  const denied = await exportAccess(req, "values.csv");
  if (denied) return denied;
  return new Response(toCsv(VALUE_COLUMNS, valueRows()), {
    headers: {
      ...EXPORT_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark-values.csv"',
    },
  });
}
