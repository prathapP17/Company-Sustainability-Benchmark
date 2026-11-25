import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { allScores, listCompanies, listPeerGroups } from "@/lib/db/queries";
import { industryName } from "@/lib/industry";

export const metadata: Metadata = { title: "Peer groups" };

export default function PeersIndex() {
  const groups = listPeerGroups();
  const companies = listCompanies();
  const scores = new Map(allScores().map((s) => [s.company_id, s]));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Peer groups</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Peer groups are broad navigation groups. Benchmarks inside each group are calculated per actual SASB industry:
          Toyota (Automobiles) and Siemens (Industrial Machinery / Electrical Equipment) share a group but are not
          industry peers. A peer median is shown only when at least three companies of one confirmed SASB industry report
          values that pass every comparability check (boundary, coverage, consolidation approach, reporting period, unit,
          Scope 2 method, source confidence).
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => {
          const members = companies.filter((c) => c.peer_group === g.id);
          return (
            <Card key={g.id} title={g.name} action={<Link href={`/peers/${g.id}`} className="text-sm text-accent hover:underline">Open benchmark →</Link>}>
              <p className="text-sm text-ink-2">{g.description}</p>
              <p className="mt-1 text-xs text-ink-muted">SASB: {(JSON.parse(g.sasb_industries) as string[]).join("; ")}</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {members.map((c) => {
                  const s = scores.get(c.id);
                  return (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span>
                        <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                          {c.name}
                        </Link>{" "}
                        <span className="text-xs text-ink-muted">· {c.primary_sasb ? industryName(c.primary_sasb) : "SASB classification needs review"}</span>
                      </span>
                      <span className="tabular text-xs text-ink-muted">
                        Transparency {s?.transparency_score !== null && s?.transparency_score !== undefined ? Math.round(s.transparency_score) : "n/a"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {(() => {
                const byIndustry = new Map<string, number>();
                for (const c of members) if (c.primary_sasb && c.research_status !== "profile_only") byIndustry.set(c.primary_sasb, (byIndustry.get(c.primary_sasb) ?? 0) + 1);
                const eligible = [...byIndustry.entries()].filter(([, n]) => n >= 3);
                return (
                  <p className="mt-3 text-xs text-ink-muted">
                    {eligible.length
                      ? `Industries with three or more researched companies: ${eligible.map(([k]) => industryName(k)).join(", ")}.`
                      : "No SASB industry in this group has three researched companies yet, so no peer median can be calculated: values are shown side by side."}
                  </p>
                );
              })()}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
