import { toCsv, VALUE_COLUMNS, valueRows } from "@/lib/export/rows";

export function GET() {
  return new Response(toCsv(VALUE_COLUMNS, valueRows()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark-values.csv"',
    },
  });
}
