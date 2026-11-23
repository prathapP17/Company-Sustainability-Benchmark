import type { Metadata } from "next";
import { CompareView } from "@/components/CompareView";
import { latestCells } from "@/lib/data/views";

export const metadata: Metadata = { title: "Compare companies" };

export default function ComparePage() {
  const data = latestCells();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Compare companies</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Pick companies and a topic. Values are each company&apos;s latest reported year, side by side. A row is marked
          when its values are not on the same boundary, method or coverage; such values are never combined or ranked.
        </p>
      </div>
      <CompareView companies={data.companies} metrics={data.metrics} cells={data.cells} />
    </div>
  );
}
