import { connection } from "next/server";
import { toCsv, VALUE_COLUMNS, valueRows } from "@/lib/export/rows";

export async function GET() {
  await connection(); // built per request, so approved values are included without a rebuild
  return new Response(toCsv(VALUE_COLUMNS, valueRows()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sustainability-benchmark-values.csv"',
    },
  });
}
